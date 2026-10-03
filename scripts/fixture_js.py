"""Regera tests/fixtures/resumo.json, o resumo da amostra que os testes em JS leem.

    python scripts/fixture_js.py

Rode depois de mudar o modelo ou o formato do resumo; um teste em Python
avisa quando a fixture ficou para tras.
"""

import shutil
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from curva.dados import ler  # noqa: E402
from curva.processar import construir  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    construir(ler((RAIZ / "tests" / "fixtures" / "amostra.csv").read_bytes()), Path(tmp))
    shutil.copy(Path(tmp) / "resumo.json", RAIZ / "tests" / "fixtures" / "resumo.json")
print("tests/fixtures/resumo.json atualizado")
