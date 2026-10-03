"""Baixa o arquivo do Tesouro e gera os dados do site.

    python scripts/construir.py                 # baixa da fonte oficial
    python scripts/construir.py --arquivo x.csv # usa um CSV ja baixado

So biblioteca padrao: nenhum pip install e necessario para construir o site.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from curva.dados import baixar, ler  # noqa: E402
from curva.processar import construir  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--arquivo", type=Path, help="CSV local em vez de baixar")
    p.add_argument("--destino", type=Path, default=RAIZ / "site" / "dados")
    a = p.parse_args()

    t0 = time.time()
    conteudo = a.arquivo.read_bytes() if a.arquivo else baixar()
    cotacoes = ler(conteudo)
    print(f"{len(cotacoes)} linhas lidas ({len(conteudo) / 1e6:.1f} MB)", flush=True)
    info = construir(cotacoes, a.destino)
    print(json.dumps(info, ensure_ascii=False, indent=1))
    print(f"pronto em {time.time() - t0:.0f} s -> {a.destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
