"""O que o arquivo do Tesouro nao diz, mas os precos dele revelam.

1. A liquidacao de cada dia, separada para compra e venda. A compra liquida em
   D+1; a venda (resgate antecipado) tambem, ate 10/09/2021, e em D+0 desde
   13/09/2021. Mas o Tesouro Direto liquida pelo calendario da B3: vespera de
   Natal e de Ano-Novo, feriados de Sao Paulo (25/01, 09/07, 20/11 antes de
   2024) e ate jogos do Brasil na Copa de 2014 empurram um dia a mais. Os
   prefixados nao dependem de indice nenhum, entao dizem sem ambiguidade qual
   liquidacao reproduz o preco publicado.

2. O VNA de cada indexador (IPCA, IGP-M, Selic): PU / cotacao. Todos os
   titulos do mesmo indexador no mesmo dia tem de concordar; a mediana entre
   eles e o VNA do dia, e a distancia de cada um ate ela e o erro do modelo.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from .calendario import somar_dias_uteis
from .dados import Cotacao
from .titulos import cotacao

# Erro mediano (R$ no PU dos prefixados) acima do qual nenhuma liquidacao
# explica o dia. Com a liquidacao certa o erro mediano fica em ~R$ 0,005
# (arredondamento do PU em centavos); com a errada passa de R$ 0,10.
TOLERANCIA_DIA = 0.05


@dataclass(frozen=True)
class Dia:
    data: date
    liq_compra: date
    liq_venda: date
    erro_mediano: float        # R$ no PU, pior lado, mediana entre os prefixados do dia
    consistente: bool          # False: nenhuma liquidacao fecha (dado ruim no arquivo)
    vna: dict[str, float]      # indexador -> VNA implicito (pelo lado da venda)


def _vivos(cs: list[Cotacao], lado: str = "compra") -> list[tuple[Cotacao, float, float]]:
    out = []
    for c in cs:
        taxa = (c.taxa_compra if lado == "compra" else c.taxa_venda) / 100
        pu = c.pu_compra if lado == "compra" else c.pu_venda
        if pu > 0:
            out.append((c, taxa, pu))
    return out


def inferir_liquidacao(data: date, cs: list[Cotacao], lado: str) -> tuple[date, float]:
    """A liquidacao (D+0 a D+3) que melhor reproduz os prefixados do dia, num lado."""
    pre = [x for x in _vivos(cs, lado) if x[0].tipo.indexador == "pre"]
    melhor: tuple[float, date] | None = None
    for lag in (1, 0, 2, 3):
        liq = somar_dias_uteis(data, lag, data)
        erros = []
        for c, taxa, pu in pre:
            k = cotacao(c.tipo, c.vencimento, liq, taxa, data)
            if k > 0:
                erros.append(abs(1000 * k - pu))
        if erros:
            e = statistics.median(erros)
            if melhor is None or e < melhor[0]:
                melhor = (e, liq)
        if melhor and melhor[0] < 0.02:
            break   # D+1 ou D+0 resolve quase todos os dias; nao gastar com os outros
    if melhor is None:
        return somar_dias_uteis(data, 1, data), float("nan")
    return melhor[1], melhor[0]


def vna_do_dia(data: date, liq: date, cs: list[Cotacao]) -> tuple[dict[str, float], list[tuple[Cotacao, float]]]:
    """VNA mediano por indexador e o desvio (R$ no PU) de cada titulo ate ele."""
    por_idx: dict[str, list[tuple[Cotacao, float]]] = defaultdict(list)
    for c, taxa, pu in _vivos(cs, "venda"):
        if c.tipo.indexador == "pre":
            continue
        k = cotacao(c.tipo, c.vencimento, liq, taxa, data)
        if k > 0:
            por_idx[c.tipo.indexador].append((c, pu / k))
    vna, desvios = {}, []
    for idx, lst in por_idx.items():
        med = statistics.median(v for _, v in lst)
        vna[idx] = med
        desvios += [(c, abs(v / med - 1) * c.pu_venda) for c, v in lst]
    return vna, desvios


def analisar(cotacoes: list[Cotacao]) -> tuple[list[Dia], dict]:
    """Liquidacao e VNA de cada dia, mais as estatisticas de aderencia do modelo."""
    por_dia: dict[date, list[Cotacao]] = defaultdict(list)
    for c in cotacoes:
        por_dia[c.data].append(c)
    dias, erros_pre, erros_vna = [], defaultdict(list), defaultdict(list)
    ruins = []
    for d in sorted(por_dia):
        cs = por_dia[d]
        liq_c, e_c = inferir_liquidacao(d, cs, "compra")
        liq, e_v = inferir_liquidacao(d, cs, "venda")
        e = max(x for x in (e_c, e_v) if x == x) if (e_c == e_c or e_v == e_v) else float("nan")
        ok = e == e and e <= TOLERANCIA_DIA
        vna, desvios = vna_do_dia(d, liq, cs)
        dias.append(Dia(d, liq_c, liq, e, ok, vna))
        if not ok:
            ruins.append(d.isoformat())
            continue
        for c, taxa, pu in _vivos(cs, "venda"):
            if c.tipo.indexador == "pre":
                k = cotacao(c.tipo, c.vencimento, liq, taxa, d)
                if k > 0:
                    erros_pre[c.tipo.nome].append(abs(1000 * k - pu))
        for c, dv in desvios:
            erros_vna[c.tipo.nome].append(dv)
    return dias, _estatisticas(erros_pre, erros_vna, ruins, dias)


def _contar_lags(dias: list[Dia], campo: str) -> dict[str, int]:
    from .calendario import dias_uteis
    cont: dict[str, int] = defaultdict(int)
    for d in dias:
        if d.consistente:
            cont[f"D+{dias_uteis(d.data, getattr(d, campo), d.data)}"] += 1
    return dict(sorted(cont.items()))


def _quantil(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def _estatisticas(erros_pre, erros_vna, ruins, dias) -> dict:
    por_tipo = {}
    for nome, xs in list(erros_pre.items()) + list(erros_vna.items()):
        por_tipo[nome] = {
            "n": len(xs),
            "mediana": round(_quantil(xs, 0.5), 4),
            "p99": round(_quantil(xs, 0.99), 4),
            "ate_1_centavo": round(sum(x <= 0.01 for x in xs) / len(xs), 4),
            "ate_10_centavos": round(sum(x <= 0.10 for x in xs) / len(xs), 4),
        }
    return {
        "dias": len(dias),
        "dias_inconsistentes": ruins,
        "liquidacao_compra": _contar_lags(dias, "liq_compra"),
        "liquidacao_venda": _contar_lags(dias, "liq_venda"),
        "por_tipo": por_tipo,
    }
