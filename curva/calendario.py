"""Dias uteis no calendario nacional, a base de todo prazo de titulo publico.

Os titulos descontam pelo numero de dias uteis (convencao 252), contados sem os
feriados nacionais -- o mesmo calendario da ANBIMA. Os feriados sao calculados,
nao tabelados, porque os fluxos do Tesouro Renda+ vao ate 2084.

O calendario muda com a lei. O Dia da Consciencia Negra (20/11) virou feriado
nacional pela Lei 14.759, de 21/12/2023, e o Tesouro Direto passou a desconta-lo
nos precos de 26/12/2023 (o primeiro dia de negociacao depois de 22/12). Antes
disso contava 20/11 como dia util em TODOS os anos, inclusive os futuros. Um preco de 2022 so e
reproduzido com o calendario de 2022 -- medido no arquivo do Tesouro: com o
calendario atual, os prefixados de 2022-2023 erram R$ 0,35 no PU mediano e o
prazo implicito sobra 1, 2 ou 4 dias uteis, um por 20/11 util ate o vencimento.
Por isso toda contagem recebe `vigente_em`: a data cujo calendario vale.
"""

from __future__ import annotations

from bisect import bisect_left
from datetime import date, timedelta
from functools import lru_cache

# Primeiro dia com precos calculados pelo calendario novo (medido no arquivo:
# 22/12/2023 so fecha com o antigo, 26/12/2023 so com o novo).
CALENDARIO_NOVO_DESDE = date(2023, 12, 26)
_ANO_ZERO = 2000


def pascoa(ano: int) -> date:
    """Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher, calendario gregoriano)."""
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


def _com_consciencia_negra(vigente_em: date | None) -> bool:
    return vigente_em is None or vigente_em >= CALENDARIO_NOVO_DESDE


@lru_cache(maxsize=None)
def _feriados(ano: int, consciencia_negra: bool) -> frozenset[date]:
    p = pascoa(ano)
    dias = {
        date(ano, 1, 1),            # Confraternizacao Universal
        p - timedelta(days=48),     # Carnaval (segunda)
        p - timedelta(days=47),     # Carnaval (terca)
        p - timedelta(days=2),      # Sexta-feira Santa
        date(ano, 4, 21),           # Tiradentes
        date(ano, 5, 1),            # Dia do Trabalho
        p + timedelta(days=60),     # Corpus Christi
        date(ano, 9, 7),            # Independencia
        date(ano, 10, 12),          # Nossa Senhora Aparecida
        date(ano, 11, 2),           # Finados
        date(ano, 11, 15),          # Proclamacao da Republica
        date(ano, 12, 25),          # Natal
    }
    # A lei vale a partir de 2024: 20/11/2023 ja tinha passado como dia util.
    if consciencia_negra and ano >= 2024:
        dias.add(date(ano, 11, 20))
    return frozenset(dias)


def feriados(ano: int, vigente_em: date | None = None) -> frozenset[date]:
    """Feriados nacionais do ano, segundo o calendario vigente em `vigente_em` (None = hoje)."""
    return _feriados(ano, _com_consciencia_negra(vigente_em))


def eh_dia_util(d: date, vigente_em: date | None = None) -> bool:
    return d.weekday() < 5 and d not in feriados(d.year, vigente_em)


@lru_cache(maxsize=None)
def _uteis_do_ano(ano: int, cn: bool) -> tuple[date, ...]:
    d, fim, uteis = date(ano, 1, 1), date(ano + 1, 1, 1), []
    fer = _feriados(ano, cn)
    while d < fim:
        if d.weekday() < 5 and d not in fer:
            uteis.append(d)
        d += timedelta(days=1)
    return tuple(uteis)


@lru_cache(maxsize=None)
def _uteis_ate_o_ano(ano: int, cn: bool) -> int:
    """Dias uteis de 01/01/2000 ate 31/12 do ano anterior."""
    if ano <= _ANO_ZERO:
        return 0
    return _uteis_ate_o_ano(ano - 1, cn) + len(_uteis_do_ano(ano - 1, cn))


def _uteis_antes(d: date, cn: bool) -> int:
    """Quantos dias uteis existem de 01/01/2000 ate o dia anterior a d."""
    if d.year < _ANO_ZERO:
        raise ValueError(f"data anterior a {_ANO_ZERO}: {d}")
    return _uteis_ate_o_ano(d.year, cn) + bisect_left(_uteis_do_ano(d.year, cn), d)


def dias_uteis(inicio: date, fim: date, vigente_em: date | None = None) -> int:
    """Dias uteis no intervalo [inicio, fim): conta o inicio, nao conta o fim.

    E a contagem da ANBIMA. Um fluxo que cai num dia nao util e pago no
    proximo dia util, e a contagem ate ele da o mesmo numero.
    """
    cn = _com_consciencia_negra(vigente_em)
    return _uteis_antes(fim, cn) - _uteis_antes(inicio, cn)


def proximo_dia_util(d: date, vigente_em: date | None = None) -> date:
    while not eh_dia_util(d, vigente_em):
        d += timedelta(days=1)
    return d


def somar_dias_uteis(d: date, n: int, vigente_em: date | None = None) -> date:
    """O n-esimo dia util depois de d (n = 0 devolve d, ou o proximo util se d nao for)."""
    d = proximo_dia_util(d, vigente_em)
    while n > 0:
        d = proximo_dia_util(d + timedelta(days=1), vigente_em)
        n -= 1
    return d
