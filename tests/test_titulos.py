from datetime import date

import pytest

from curva.calendario import dias_uteis
from curva.processar import ano_do_nome, id_titulo, nome_titulo
from curva.titulos import TIPOS, cotacao, duration, fluxos, fluxos_futuros, pu

LTN = TIPOS["Tesouro Prefixado"]
NTNF = TIPOS["Tesouro Prefixado com Juros Semestrais"]
NTNB = TIPOS["Tesouro IPCA+ com Juros Semestrais"]
RENDA = TIPOS["Tesouro Renda+ Aposentadoria Extra"]
EDUCA = TIPOS["Tesouro Educa+"]


def test_prefixado_e_a_formula_fechada():
    liq, venc, taxa = date(2026, 10, 5), date(2032, 1, 1), 0.1415
    du = dias_uteis(liq, date(2032, 1, 2))   # 01/01 e feriado: paga no dia util seguinte
    assert pu(LTN, venc, liq, taxa) == pytest.approx(1000 / (1 + taxa) ** (du / 252))


def test_preco_oficial_de_02_10_2026_do_prefixado_2032():
    # Arquivo do Tesouro: taxa 14,15%, PU de compra R$ 502,06, liquidacao D+1.
    assert pu(LTN, date(2032, 1, 1), date(2026, 10, 5), 0.1415) == pytest.approx(502.06, abs=0.01)


def test_cupom_semestral_do_prefixado_com_juros():
    fl = fluxos(NTNF, date(2037, 1, 1))
    assert fl[0].fracao == pytest.approx(1.10 ** 0.5 - 1)        # 4,88% por semestre
    assert fl[-1].fracao == pytest.approx(1 + 1.10 ** 0.5 - 1)
    datas = {(f.data.month, f.data.day) for f in fl}
    assert datas <= {(1, 2), (1, 3), (1, 4), (1, 5), (7, 1), (7, 2), (7, 3)}   # 01/01 e 01/07, no dia util


def test_cupom_do_ipca_com_juros_vai_ate_o_comeco_do_seculo():
    fl = fluxos(NTNB, date(2060, 8, 15))
    assert fl[0].data.year <= 2001            # titulos longos nao perdem os primeiros cupons
    assert fl[-1].data == date(2060, 8, 16)   # 15/08/2060 e domingo


def test_renda_mais_paga_240_parcelas_que_terminam_no_vencimento():
    venc = date(2084, 12, 15)
    fl = fluxos(RENDA, venc)
    assert len(fl) == 240
    assert sum(f.fracao for f in fl) == pytest.approx(1.0)
    assert fl[0].data.year == 2065 and fl[0].data.month == 1
    assert ano_do_nome(RENDA, venc) == 2065
    assert nome_titulo(RENDA, venc) == "Tesouro Renda+ Aposentadoria Extra 2065"


def test_educa_mais_paga_60_parcelas():
    venc = date(2030, 12, 15)
    assert len(fluxos(EDUCA, venc)) == 60
    assert ano_do_nome(EDUCA, venc) == 2026
    assert id_titulo(EDUCA, venc) == "educa-2030-12-15"


def test_fluxos_futuros_excluem_o_que_paga_na_liquidacao():
    venc = date(2035, 5, 15)
    ff = fluxos_futuros(NTNB, venc, date(2026, 5, 15))
    assert all(f.data > date(2026, 5, 15) for f in ff)


def test_duration_de_titulo_sem_cupom_e_o_prazo():
    liq, venc = date(2026, 10, 5), date(2032, 1, 1)
    assert duration(LTN, venc, liq, 0.14) == pytest.approx(dias_uteis(liq, date(2032, 1, 2)) / 252)


def test_duration_com_cupom_e_menor_que_o_prazo():
    liq = date(2026, 10, 5)
    prazo = dias_uteis(liq, date(2037, 1, 2)) / 252
    assert duration(NTNF, date(2037, 1, 1), liq, 0.14) < prazo * 0.75


def test_indexado_sem_vna_e_erro():
    with pytest.raises(ValueError):
        pu(NTNB, date(2035, 5, 15), date(2026, 10, 5), 0.075)


def test_preco_cai_quando_a_taxa_sobe():
    liq = date(2026, 10, 5)
    for t, v in ((LTN, date(2029, 1, 1)), (NTNB, date(2045, 5, 15)), (RENDA, date(2084, 12, 15))):
        assert cotacao(t, v, liq, 0.08) < cotacao(t, v, liq, 0.07)
