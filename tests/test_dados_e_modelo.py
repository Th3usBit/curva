"""Modelo contra precos oficiais reais (tests/fixtures/amostra.csv).

A amostra tem dez dias do arquivo do Tesouro escolhidos para passar por todos
os regimes que o modelo precisa reconhecer: liquidacao D+2 no fim do ano,
venda em D+1 antes e D+0 depois de 13/09/2021, o calendario sem e com o
20/11, um dia de pagamento de cupom e um dia com dado ruim no proprio arquivo.
"""

import json
from datetime import date
from pathlib import Path

import pytest

from curva.calendario import dias_uteis
from curva.dados import ArquivoInvalido, ler
from curva.modelo import analisar
from curva.processar import construir

AQUI = Path(__file__).parent
AMOSTRA = (AQUI / "fixtures" / "amostra.csv").read_bytes()


@pytest.fixture(scope="module")
def analise():
    cot = ler(AMOSTRA)
    dias, estat = analisar(cot)
    return cot, {d.data: d for d in dias}, estat


CABECALHO = "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha\n"


def test_le_a_amostra():
    cot = ler(AMOSTRA)
    assert len(cot) == 429
    assert cot[-1].data == date(2026, 10, 2)


def test_coluna_faltando_derruba():
    with pytest.raises(ArquivoInvalido, match="colunas"):
        ler(b"Tipo Titulo;Data Base\nTesouro Selic;02/10/2026\n")


def test_titulo_desconhecido_derruba():
    with pytest.raises(ArquivoInvalido, match="desconhecido"):
        ler((CABECALHO + "Tesouro Novo;01/01/2030;02/10/2026;1,0;1,1;900,0;899,0;899,0\n").encode())


def test_linha_repetida_derruba():
    linha = "Tesouro Prefixado;01/01/2030;02/10/2026;13,0;13,1;700,0;699,0;699,0\n"
    with pytest.raises(ArquivoInvalido, match="repetida"):
        ler((CABECALHO + linha + linha).encode())


def test_numero_ilegivel_derruba():
    with pytest.raises(ArquivoInvalido):
        ler((CABECALHO + "Tesouro Prefixado;01/01/2030;02/10/2026;abc;13,1;700,0;699,0;699,0\n").encode())


@pytest.mark.parametrize("dia,compra,venda", [
    (date(2005, 12, 29), 2, 2),    # 30/12 sem liquidacao na B3
    (date(2010, 6, 30), 1, 1),
    (date(2021, 9, 10), 1, 1),     # ultimo dia com venda em D+1
    (date(2021, 9, 13), 1, 0),     # primeiro dia com venda em D+0
    (date(2023, 12, 22), 1, 0),
    (date(2026, 10, 2), 1, 0),
])
def test_liquidacao_inferida(analise, dia, compra, venda):
    _, dias, _ = analise
    d = dias[dia]
    assert d.consistente
    assert dias_uteis(d.data, d.liq_compra, d.data) == compra
    assert dias_uteis(d.data, d.liq_venda, d.data) == venda


def test_virada_do_calendario_em_dezembro_de_2023(analise):
    # 22/12 so fecha com o calendario antigo e 26/12 so com o novo; os dois fecham.
    _, dias, _ = analise
    assert dias[date(2023, 12, 22)].erro_mediano < 0.02
    assert dias[date(2023, 12, 26)].erro_mediano < 0.02


def test_dia_com_dado_ruim_e_marcado(analise):
    _, dias, estat = analise
    assert not dias[date(2010, 7, 1)].consistente
    assert estat["dias_inconsistentes"] == ["2010-07-01"]


def test_prefixados_reproduzidos_ao_centavo(analise):
    _, _, estat = analise
    for nome in ("Tesouro Prefixado", "Tesouro Prefixado com Juros Semestrais"):
        assert estat["por_tipo"][nome]["ate_1_centavo"] == 1.0


def test_indexados_concordam_sobre_o_vna(analise):
    _, _, estat = analise
    for nome in ("Tesouro IPCA+", "Tesouro IPCA+ com Juros Semestrais", "Tesouro Renda+ Aposentadoria Extra", "Tesouro Educa+"):
        assert estat["por_tipo"][nome]["ate_10_centavos"] == 1.0, nome


def test_vna_do_ipca_e_plausivel(analise):
    # VNA da NTN-B: R$ 1.000 em 15/07/2000 corrigidos pelo IPCA; passa de R$ 4.500 em 2026.
    _, dias, _ = analise
    v = dias[date(2026, 10, 2)].vna
    assert 4500 < v["ipca"] < 5000
    assert dias[date(2005, 12, 29)].vna["ipca"] < 2000


def test_construir_gera_os_arquivos(tmp_path):
    info = construir(ler(AMOSTRA), tmp_path)
    assert info["data"] == "2026-10-02"
    resumo = json.loads((tmp_path / "resumo.json").read_text(encoding="utf-8"))
    assert len(resumo["titulos"]) == 58
    assert resumo["du_mes"][0] == 0 and resumo["du_mes"][12] in range(248, 256)
    for nome in ("curvas.json", "vna.json", "titulos.json", "validacao.json"):
        assert (tmp_path / nome).exists()
    hist = json.loads((tmp_path / "historico" / "prefixado-2032-01-01.json").read_text(encoding="utf-8"))
    assert hist["nome"] == "Tesouro Prefixado 2032"
    assert len(hist["datas"]) == len(hist["pu_venda"])


def test_fixture_do_javascript_esta_em_dia(tmp_path):
    """tests/fixtures/resumo.json (lido pelos testes em JS) = o que o Python gera hoje."""
    construir(ler(AMOSTRA), tmp_path)
    gerado = json.loads((tmp_path / "resumo.json").read_text(encoding="utf-8"))
    salvo = json.loads((AQUI / "fixtures" / "resumo.json").read_text(encoding="utf-8"))
    for r in (gerado, salvo):
        r.pop("gerado_em")
    assert gerado == salvo, "rode: python scripts/fixture_js.py"
