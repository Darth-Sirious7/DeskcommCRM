#!/usr/bin/env bash
# Tipos do schema REAL que o CI acabou de instalar; nunca escreve no arquivo gerado do produto.
set -euo pipefail

[ "${GITHUB_ACTIONS:-}" = true ] || { echo "Use somente no banco descartável do E2E no CI." >&2; exit 1; }
destino="${1:?uso: $0 evidencia-gerada/tipos-do-banco <tabela>...}"
shift
[ "$#" -gt 0 ] || { echo "Declare as tabelas que esta prova precisa encontrar." >&2; exit 1; }
case "$destino" in evidencia-gerada/tipos-do-banco) ;; *) echo "Destino de artefato inesperado." >&2; exit 1 ;; esac

mkdir -p "$destino"
temporario="$(mktemp "$destino/tipos.XXXXXX")"
trap 'rm -f "$temporario"' EXIT
# A URL é a do banco sintético fixo deste workflow; não há .env ou credencial de cliente.
supabase gen types --lang typescript \
  --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
  --schema public > "$temporario"
test -s "$temporario"
for tabela in "$@"; do
  case "$tabela" in *[!a-z_0-9]*|'') echo "Nome de tabela inválido." >&2; exit 1 ;; esac
  grep -Eq "^[[:space:]]+$tabela: \\{" "$temporario" || {
    echo "O schema gerado não contém a tabela esperada: $tabela" >&2
    exit 1
  }
done
mv "$temporario" "$destino/database.types.ts"
python3 - "$destino" "$@" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

destino = Path(sys.argv[1])
prova = {
    "synthetic": True,
    "schema": "public",
    "database": "Supabase descartável do E2E em 127.0.0.1:54322",
    "tree_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "candidate_sha": os.environ.get("CANDIDATO_SHA"),
    "run_id": os.environ.get("GITHUB_RUN_ID"),
    "baseline_sha256": hashlib.sha256(Path("supabase/baseline.sql").read_bytes()).hexdigest(),
    "types_sha256": hashlib.sha256((destino / "database.types.ts").read_bytes()).hexdigest(),
    "tables_required": sys.argv[2:],
    "product_generated_file_modified": False,
}
(destino / "origem.json").write_text(json.dumps(prova, indent=2) + "\n")
PY
