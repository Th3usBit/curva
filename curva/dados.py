"""Leitura do arquivo oficial de precos e taxas do Tesouro Direto.

Fonte: Tesouro Transparente, conjunto "Taxas dos Titulos Ofertados pelo Tesouro
Direto" (dados abertos, atualizado todo dia util). Um CSV com ';', virgula
decimal e datas dd/mm/aaaa -- cerca de 15 MB com todo o historico desde 2004.

O leitor e estrito: coluna faltando, titulo desconhecido, numero ilegivel ou
linha repetida derrubam a leitura. Melhor publicar o site de ontem do que um
site com dados errados.
"""

from __future__ import annotations

import csv
import io
import time
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime

from .titulos import TIPOS, Tipo

URL = (
    "https://www.tesourotransparente.gov.br/ckan/dataset/"
    "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
    "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv"
)

COLUNAS = (
    "Tipo Titulo", "Data Vencimento", "Data Base",
    "Taxa Compra Manha", "Taxa Venda Manha",
    "PU Compra Manha", "PU Venda Manha", "PU Base Manha",
)


class ArquivoInvalido(ValueError):
    pass


@dataclass(frozen=True)
class Cotacao:
    tipo: Tipo
    vencimento: date
    data: date            # "Data Base": o dia do preco
    taxa_compra: float    # % a.a. que o investidor recebe ao comprar
    taxa_venda: float     # % a.a. usada quando o investidor vende ao Tesouro
    pu_compra: float      # R$ por titulo para comprar (0 = fora de venda)
    pu_venda: float       # R$ por titulo ao vender ao Tesouro


def baixar(url: str = URL, tentativas: int = 4, timeout: float = 120) -> bytes:
    """Baixa o CSV, com novas tentativas espacadas (o servidor as vezes recusa)."""
    erro: Exception | None = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curva (github.com/Th3usBit)"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # rede: qualquer falha merece nova tentativa
            erro = e
            if i + 1 < tentativas:
                time.sleep(10 * 2 ** i)
    raise ConnectionError(f"nao consegui baixar {url}: {erro}") from erro


def _data(s: str) -> date:
    return datetime.strptime(s.strip(), "%d/%m/%Y").date()


def _num(s: str) -> float:
    return float(s.strip().replace(".", "").replace(",", ".")) if "," in s else float(s)


def ler(conteudo: bytes) -> list[Cotacao]:
    texto = conteudo.decode("utf-8-sig") if conteudo[:3] == b"\xef\xbb\xbf" else conteudo.decode("latin-1")
    leitor = csv.DictReader(io.StringIO(texto), delimiter=";")
    faltam = [c for c in COLUNAS if c not in (leitor.fieldnames or [])]
    if faltam:
        raise ArquivoInvalido(f"colunas ausentes: {faltam}; vieram {leitor.fieldnames}")
    out, vistos = [], set()
    for n, r in enumerate(leitor, start=2):
        try:
            tipo = TIPOS[r["Tipo Titulo"].strip()]
        except KeyError:
            raise ArquivoInvalido(f"linha {n}: titulo desconhecido {r['Tipo Titulo']!r}") from None
        try:
            c = Cotacao(
                tipo, _data(r["Data Vencimento"]), _data(r["Data Base"]),
                _num(r["Taxa Compra Manha"]), _num(r["Taxa Venda Manha"]),
                _num(r["PU Compra Manha"]), _num(r["PU Venda Manha"]),
            )
        except ValueError as e:
            raise ArquivoInvalido(f"linha {n}: {e}") from None
        chave = (tipo.nome, c.vencimento, c.data)
        if chave in vistos:
            raise ArquivoInvalido(f"linha {n}: repetida {chave}")
        vistos.add(chave)
        out.append(c)
    if not out:
        raise ArquivoInvalido("arquivo sem linhas")
    out.sort(key=lambda c: (c.data, c.tipo.nome, c.vencimento))
    return out
