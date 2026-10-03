from datetime import date

from curva.calendario import (
    CALENDARIO_NOVO_DESDE, dias_uteis, eh_dia_util, feriados, pascoa, proximo_dia_util, somar_dias_uteis,
)


def test_pascoa_em_anos_conhecidos():
    assert pascoa(2024) == date(2024, 3, 31)
    assert pascoa(2025) == date(2025, 4, 20)
    assert pascoa(2026) == date(2026, 4, 5)
    assert pascoa(2038) == date(2038, 4, 25)   # a mais tardia possivel no seculo


def test_feriados_moveis_de_2026():
    f = feriados(2026)
    assert date(2026, 2, 16) in f and date(2026, 2, 17) in f   # Carnaval
    assert date(2026, 4, 3) in f                               # Sexta-feira Santa
    assert date(2026, 6, 4) in f                               # Corpus Christi


def test_consciencia_negra_depende_do_calendario_vigente():
    # O mesmo 20/11/2025 e feriado no calendario de hoje e dia util no de 2022.
    assert not eh_dia_util(date(2025, 11, 20))
    assert eh_dia_util(date(2025, 11, 20), vigente_em=date(2022, 6, 1))
    # A lei so vale a partir de 2024: 20/11/2023 foi dia util em qualquer calendario.
    assert eh_dia_util(date(2023, 11, 20))
    assert CALENDARIO_NOVO_DESDE == date(2023, 12, 26)


def test_dias_uteis_conta_inicio_e_nao_conta_fim():
    seg, ter = date(2026, 9, 28), date(2026, 9, 29)
    assert dias_uteis(seg, seg) == 0
    assert dias_uteis(seg, ter) == 1
    sex, seg_seguinte = date(2026, 10, 2), date(2026, 10, 5)
    assert dias_uteis(sex, seg_seguinte) == 1       # sabado e domingo nao contam


def test_dias_uteis_e_aditivo():
    a, b, c = date(2024, 1, 10), date(2031, 7, 3), date(2084, 12, 15)
    assert dias_uteis(a, c) == dias_uteis(a, b) + dias_uteis(b, c)


def test_feriado_no_meio_tira_um_dia():
    # 12/10/2026 (segunda) e Nossa Senhora Aparecida.
    assert dias_uteis(date(2026, 10, 9), date(2026, 10, 14)) == 2


def test_proximo_e_somar_dias_uteis():
    assert proximo_dia_util(date(2026, 10, 3)) == date(2026, 10, 5)   # sabado -> segunda
    assert somar_dias_uteis(date(2026, 10, 9), 1) == date(2026, 10, 13)
    assert somar_dias_uteis(date(2026, 10, 2), 0) == date(2026, 10, 2)


def test_ano_tem_entre_245_e_256_dias_uteis():
    for ano in range(2004, 2085):
        n = dias_uteis(date(ano, 1, 1), date(ano + 1, 1, 1))
        assert 245 <= n <= 256, (ano, n)
