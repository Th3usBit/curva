"""Fluxos de caixa e precificacao dos titulos do Tesouro Direto.

Todo titulo e um conjunto de pagamentos futuros descontados pela taxa do dia:

    PU = base x soma( fracao_i / (1 + taxa) ** (du_i / 252) )

`base` e R$ 1.000 nos prefixados e o valor nominal atualizado (VNA) nos
indexados: IPCA, IGP-M ou Selic acumulados desde a emissao. O VNA nao vem no
arquivo do Tesouro, mas sai dele: VNA = PU / cotacao. Os testes conferem que o
VNA implicito e o mesmo em todos os titulos do mesmo indexador no mesmo dia --
se um fluxo estivesse errado, o VNA daquele titulo destoaria dos outros.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .calendario import dias_uteis, proximo_dia_util


@dataclass(frozen=True)
class Tipo:
    nome: str           # como aparece no arquivo do Tesouro
    curto: str          # nome curto para a interface
    codigo: str         # nome tecnico (STN/ANBIMA)
    indexador: str      # "pre", "ipca", "igpm" ou "selic"
    cupom_anual: float  # juros semestrais (0 = sem cupom)
    parcelas: int       # pagamentos mensais no fim (Renda+/Educa+); 0 = principal unico


TIPOS: dict[str, Tipo] = {t.nome: t for t in (
    Tipo("Tesouro Prefixado", "Prefixado", "LTN", "pre", 0.0, 0),
    Tipo("Tesouro Prefixado com Juros Semestrais", "Prefixado c/ juros", "NTN-F", "pre", 0.10, 0),
    Tipo("Tesouro IPCA+", "IPCA+", "NTN-B Principal", "ipca", 0.0, 0),
    Tipo("Tesouro IPCA+ com Juros Semestrais", "IPCA+ c/ juros", "NTN-B", "ipca", 0.06, 0),
    Tipo("Tesouro Selic", "Selic", "LFT", "selic", 0.0, 0),
    Tipo("Tesouro IGPM+ com Juros Semestrais", "IGP-M+ c/ juros", "NTN-C", "igpm", 0.06, 0),
    Tipo("Tesouro Renda+ Aposentadoria Extra", "Renda+", "NTN-B1", "ipca", 0.0, 240),
    Tipo("Tesouro Educa+", "Educa+", "NTN-B1", "ipca", 0.0, 60),
)}


def cupom_anual(tipo: Tipo, vencimento: date) -> float:
    # A NTN-C 2031 e a unica com cupom de 12% a.a.; as outras pagavam 6%.
    if tipo.codigo == "NTN-C" and vencimento.year == 2031:
        return 0.12
    return tipo.cupom_anual


def _menos_meses(d: date, meses: int) -> date:
    ano, mes = divmod(d.year * 12 + d.month - 1 - meses, 12)
    return date(ano, mes + 1, d.day)


@dataclass(frozen=True)
class Fluxo:
    data: date      # data de pagamento (ja no dia util)
    fracao: float   # quanto paga, em unidades da base (1 = a base inteira)


def fluxos(tipo: Tipo, vencimento: date) -> list[Fluxo]:
    """Todos os pagamentos do titulo, do primeiro ao vencimento."""
    if tipo.parcelas:
        # Renda+/Educa+: a data de vencimento do arquivo e a ULTIMA parcela;
        # as anteriores caem no mesmo dia dos meses antes dela.
        datas = [_menos_meses(vencimento, k) for k in range(tipo.parcelas - 1, -1, -1)]
        return [Fluxo(proximo_dia_util(d), 1.0 / tipo.parcelas) for d in datas]
    if not tipo.cupom_anual:
        return [Fluxo(proximo_dia_util(vencimento), 1.0)]
    cupom = (1 + cupom_anual(tipo, vencimento)) ** 0.5 - 1
    # Cupons a cada 6 meses, contados para tras a partir do vencimento, ate
    # 2000: antes do primeiro preco do arquivo (2004) e depois de qualquer
    # fluxo que um preco do arquivo ainda desconte.
    n = (vencimento.year - 2000) * 2
    datas = [_menos_meses(vencimento, 6 * k) for k in range(n, -1, -1)]
    out = [Fluxo(proximo_dia_util(d), cupom) for d in datas]
    return out[:-1] + [Fluxo(out[-1].data, 1.0 + cupom)]


def fluxos_futuros(tipo: Tipo, vencimento: date, liquidacao: date) -> list[Fluxo]:
    """Pagamentos que quem compra na liquidacao ainda vai receber."""
    return [f for f in fluxos(tipo, vencimento) if f.data > liquidacao]


def cotacao(tipo: Tipo, vencimento: date, liquidacao: date, taxa: float,
            vigente_em: date | None = None) -> float:
    """Preco por unidade de base: soma dos fluxos futuros descontados.

    taxa em fracao (0.0725 = 7,25% a.a.). Para o Tesouro Selic a taxa e o agio
    ou desagio sobre a Selic, e a cotacao e so o desconto desse spread.
    vigente_em: data cujo calendario de feriados vale (padrao: a liquidacao).
    """
    vigente_em = vigente_em or liquidacao
    soma = 0.0
    for f in fluxos_futuros(tipo, vencimento, liquidacao):
        du = dias_uteis(liquidacao, f.data, vigente_em)
        soma += f.fracao / (1 + taxa) ** (du / 252)
    return soma


def pu(tipo: Tipo, vencimento: date, liquidacao: date, taxa: float, vna: float | None = None,
       vigente_em: date | None = None) -> float:
    """Preco unitario em reais. Indexados precisam do VNA do dia."""
    if tipo.indexador == "pre":
        return 1000.0 * cotacao(tipo, vencimento, liquidacao, taxa, vigente_em)
    if vna is None:
        raise ValueError(f"{tipo.nome} precisa do VNA")
    return vna * cotacao(tipo, vencimento, liquidacao, taxa, vigente_em)


def duration(tipo: Tipo, vencimento: date, liquidacao: date, taxa: float,
             vigente_em: date | None = None) -> float:
    """Duration de Macaulay em anos (prazo medio dos fluxos, ponderado pelo valor)."""
    vigente_em = vigente_em or liquidacao
    soma, ponderada = 0.0, 0.0
    for f in fluxos_futuros(tipo, vencimento, liquidacao):
        anos = dias_uteis(liquidacao, f.data, vigente_em) / 252
        vp = f.fracao / (1 + taxa) ** anos
        soma += vp
        ponderada += vp * anos
    return ponderada / soma if soma else 0.0
