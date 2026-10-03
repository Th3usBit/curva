"""Do CSV do Tesouro aos arquivos JSON que o site le.

Saidas (em site/dados/):

  resumo.json         titulos a venda no ultimo dia, com fluxos futuros em dias
                      uteis, VNA de cada indexador e a tabela de dias uteis por
                      mes -- tudo o que o simulador "E se?" precisa no navegador
  curvas.json         curva prefixada e curva real (IPCA+) no fim de cada mes
  vna.json            VNA implicito de cada indexador, dia a dia (da a Selic e o
                      IPCA acumulados entre duas datas quaisquer)
  titulos.json        catalogo de todos os titulos que ja existiram
  historico/<id>.json taxas e precos dia a dia de um titulo, e os pagamentos
                      (cupons/parcelas) que ele ja fez, em reais
  validacao.json      quanto o modelo reproduz dos precos oficiais
"""

from __future__ import annotations

import json
import os
from bisect import bisect_right
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

from .calendario import dias_uteis
from .dados import URL, Cotacao
from .modelo import Dia, analisar
from .titulos import TIPOS, Tipo, cotacao, duration, fluxos, fluxos_futuros

_SLUG = {
    "LTN": "prefixado", "NTN-F": "prefixado-juros", "NTN-B Principal": "ipca",
    "NTN-B": "ipca-juros", "LFT": "selic", "NTN-C": "igpm-juros",
}
MESES_TABELA = 12 * 62   # dias uteis por mes ate alem do ultimo Renda+ (2084)


def slug(tipo: Tipo) -> str:
    if tipo.codigo == "NTN-B1":
        return "renda" if tipo.parcelas == 240 else "educa"
    return _SLUG[tipo.codigo]


def ano_do_nome(tipo: Tipo, vencimento: date) -> int:
    """O ano que aparece no nome comercial do titulo.

    Renda+ e Educa+ levam o ano em que comecam a pagar (a conversao), nao o da
    ultima parcela: o Renda+ 2065 paga de jan/2065 a dez/2084.
    """
    if tipo.parcelas:
        return vencimento.year - tipo.parcelas // 12 + 1
    return vencimento.year


def id_titulo(tipo: Tipo, vencimento: date) -> str:
    return f"{slug(tipo)}-{vencimento.isoformat()}"


def nome_titulo(tipo: Tipo, vencimento: date) -> str:
    return f"{tipo.nome} {ano_do_nome(tipo, vencimento)}"


def _r(x: float, casas: int) -> float:
    return round(x, casas)


def _mais_meses(d: date, meses: int) -> date:
    ano, mes = divmod(d.year * 12 + d.month - 1 + meses, 12)
    return date(ano, mes + 1, min(d.day, monthrange(ano, mes + 1)[1]))


def _meta(tipo: Tipo, venc: date) -> dict:
    return {
        "id": id_titulo(tipo, venc),
        "nome": nome_titulo(tipo, venc),
        "tipo": tipo.nome,
        "curto": tipo.curto,
        "codigo": tipo.codigo,
        "indexador": tipo.indexador,
        "vencimento": venc.isoformat(),
        "ano": ano_do_nome(tipo, venc),
    }


def _resumo(ultimo: Dia, cs: list[Cotacao], validacao: dict) -> dict:
    liq = ultimo.liq_compra
    titulos = []
    for c in sorted(cs, key=lambda c: (c.tipo.nome, c.vencimento)):
        futuros = fluxos_futuros(c.tipo, c.vencimento, liq)
        if not futuros:
            continue
        t = _meta(c.tipo, c.vencimento)
        a_venda = c.pu_compra > 0
        taxa = (c.taxa_compra if a_venda else c.taxa_venda) / 100
        # Base do proprio titulo na liquidacao da compra (R$ 1.000 nos
        # prefixados; o VNA nos indexados), tirada do PU publicado: com ela o
        # simulador reproduz o PU do dia exatamente, sem o dia de diferenca
        # entre a liquidacao da compra (D+1) e a da venda (D+0).
        k = cotacao(c.tipo, c.vencimento, liq, taxa, ultimo.data)
        pu_ref = c.pu_compra if a_venda else c.pu_venda
        base = 1000.0 if c.tipo.indexador == "pre" else pu_ref / k
        t.update({
            "base": _r(base, 6),
            "a_venda": a_venda,
            "taxa_compra": c.taxa_compra,
            "taxa_venda": c.taxa_venda,
            "pu_compra": c.pu_compra,
            "pu_venda": c.pu_venda,
            "du": dias_uteis(liq, futuros[-1].data, ultimo.data),
            "duration": _r(duration(c.tipo, c.vencimento, liq, taxa, ultimo.data), 4),
            # Fluxos futuros: [dias uteis desde a liquidacao da compra, fracao da base]
            "fluxos": [[dias_uteis(liq, f.data, ultimo.data), _r(f.fracao, 10)] for f in futuros],
            "primeiro_fluxo": futuros[0].data.isoformat(),
        })
        titulos.append(t)
    return {
        "data": ultimo.data.isoformat(),
        "liquidacao": liq.isoformat(),
        "gerado_em": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "fonte": URL,
        "vna": {k: _r(v, 6) for k, v in ultimo.vna.items()},
        # du_mes[m] = dias uteis da liquidacao ate o mesmo dia, m meses depois
        "du_mes": [dias_uteis(liq, _mais_meses(liq, m), ultimo.data) for m in range(MESES_TABELA + 1)],
        "titulos": titulos,
        "validacao": {
            "dias": validacao["dias"],
            "precos_ate_1_centavo": validacao["geral"]["ate_1_centavo"],
            "precos_ate_10_centavos": validacao["geral"]["ate_10_centavos"],
        },
    }


def _ponto_curva(c: Cotacao, d: Dia) -> list[float] | None:
    if c.pu_venda <= 0:
        return None
    taxa = c.taxa_compra if c.pu_compra > 0 else c.taxa_venda
    k = fluxos_futuros(c.tipo, c.vencimento, d.liq_compra)
    if not k:
        return None
    anos = dias_uteis(d.liq_compra, k[-1].data, d.data) / 252
    dur = duration(c.tipo, c.vencimento, d.liq_compra, taxa / 100, d.data)
    return [_r(anos, 3), _r(dur, 3), taxa, c.tipo.codigo, c.vencimento.isoformat()]


def _curvas(dias: list[Dia], por_dia: dict[date, list[Cotacao]]) -> dict:
    """Curva prefixada e real no ultimo dia util de cada mes (e no ultimo dia)."""
    ultimos_do_mes: dict[tuple[int, int], Dia] = {}
    for d in dias:
        if d.consistente:
            ultimos_do_mes[(d.data.year, d.data.month)] = d
    escolhidos = sorted(ultimos_do_mes.values(), key=lambda d: d.data)
    if dias[-1] not in escolhidos:
        escolhidos.append(dias[-1])
    out = []
    for d in escolhidos:
        pre, real = [], []
        for c in por_dia[d.data]:
            p = _ponto_curva(c, d)
            if p is None:
                continue
            if c.tipo.codigo in ("LTN", "NTN-F"):
                pre.append(p)
            elif c.tipo.codigo in ("NTN-B Principal", "NTN-B"):
                real.append(p)
        out.append({"data": d.data.isoformat(), "pre": sorted(pre), "real": sorted(real)})
    return {"colunas": ["anos_ate_vencimento", "duration", "taxa", "codigo", "vencimento"], "curvas": out}


def _serie_vna(dias: list[Dia]) -> dict:
    """VNA por data de liquidacao da venda: o valor do indexador naquele dia."""
    pontos: dict[date, dict[str, float]] = {}
    for d in dias:
        if d.consistente:
            pontos[d.liq_venda] = d.vna
    datas = sorted(pontos)
    serie = {"datas": [x.isoformat() for x in datas]}
    for idx in ("ipca", "igpm", "selic"):
        serie[idx] = [(_r(pontos[x][idx], 6) if idx in pontos[x] else None) for x in datas]
    return serie


class _VNA:
    """Consulta do VNA de um indexador numa data (o da liquidacao mais recente ate ela)."""

    def __init__(self, dias: list[Dia]):
        self.por_idx: dict[str, tuple[list[date], list[float]]] = {}
        acc: dict[str, list[tuple[date, float]]] = defaultdict(list)
        for d in dias:
            if d.consistente:
                for idx, v in d.vna.items():
                    acc[idx].append((d.liq_venda, v))
        for idx, lst in acc.items():
            lst.sort()
            self.por_idx[idx] = ([x for x, _ in lst], [v for _, v in lst])

    def em(self, idx: str, d: date) -> float | None:
        datas, vals = self.por_idx.get(idx, ([], []))
        i = bisect_right(datas, d) - 1
        if i < 0 or (d - datas[i]).days > 10:
            return None
        return vals[i]


def _historico(tipo: Tipo, venc: date, linhas: list[Cotacao], vna: _VNA, ultimo: date) -> dict:
    h = _meta(tipo, venc)
    linhas = sorted(linhas, key=lambda c: c.data)
    h.update({
        "datas": [c.data.isoformat() for c in linhas],
        "taxa_compra": [c.taxa_compra for c in linhas],
        "taxa_venda": [c.taxa_venda for c in linhas],
        "pu_compra": [c.pu_compra for c in linhas],
        "pu_venda": [c.pu_venda for c in linhas],
    })
    # Pagamentos ja feitos (ate o ultimo dia do arquivo), em reais por titulo.
    pagos = []
    for f in fluxos(tipo, venc):
        if f.data > ultimo or f.data < linhas[0].data:
            continue
        base = 1000.0 if tipo.indexador == "pre" else vna.em(tipo.indexador, f.data)
        if base is not None:
            pagos.append([f.data.isoformat(), _r(base * f.fracao, 6)])
    h["pagamentos"] = pagos
    h["vencido"] = fluxos(tipo, venc)[-1].data <= ultimo
    return h


def _validacao(estat: dict) -> dict:
    tot = sum(v["n"] for v in estat["por_tipo"].values())
    def pond(campo):
        return _r(sum(v[campo] * v["n"] for v in estat["por_tipo"].values()) / tot, 4)
    estat = dict(estat)
    estat["geral"] = {"n": tot, "ate_1_centavo": pond("ate_1_centavo"), "ate_10_centavos": pond("ate_10_centavos")}
    return estat


def _gravar(caminho: Path, obj) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, caminho)


def construir(cotacoes: list[Cotacao], destino: Path) -> dict:
    dias, estat = analisar(cotacoes)
    validacao = _validacao(estat)
    por_dia: dict[date, list[Cotacao]] = defaultdict(list)
    por_titulo: dict[tuple[str, date], list[Cotacao]] = defaultdict(list)
    for c in cotacoes:
        por_dia[c.data].append(c)
        por_titulo[(c.tipo.nome, c.vencimento)].append(c)
    ultimo = dias[-1]
    if not ultimo.consistente:
        raise ValueError(f"o ultimo dia do arquivo ({ultimo.data}) nao fecha com o modelo; nao publico")
    vna = _VNA(dias)

    resumo = _resumo(ultimo, por_dia[ultimo.data], validacao)
    _gravar(destino / "resumo.json", resumo)
    _gravar(destino / "curvas.json", _curvas(dias, por_dia))
    _gravar(destino / "vna.json", _serie_vna(dias))
    _gravar(destino / "validacao.json", validacao)

    catalogo = []
    for (nome, venc), linhas in sorted(por_titulo.items()):
        tipo = TIPOS[nome]
        h = _historico(tipo, venc, linhas, vna, ultimo.data)
        _gravar(destino / "historico" / f"{h['id']}.json", h)
        catalogo.append({k: h[k] for k in ("id", "nome", "tipo", "curto", "indexador", "vencimento", "ano", "vencido")}
                        | {"inicio": h["datas"][0], "fim": h["datas"][-1]})
    _gravar(destino / "titulos.json", catalogo)
    return {"data": ultimo.data.isoformat(), "titulos_hoje": len(resumo["titulos"]),
            "titulos_total": len(catalogo), "validacao": validacao["geral"]}
