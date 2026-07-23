#!/usr/bin/env bash
# Start the full CC-RAGOS stack host-native (no Docker).
# Services: qdrant :6333, ingestion :8101, retriever :8100, web :3000.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p qdrant-storage logs

start() { # name, logfile, command...
  local name="$1" log="$2"; shift 2
  if lsof -ti "$3" >/dev/null 2>&1; then echo "• $name already on $3"; return; fi
  "$@" > "logs/$name.log" 2>&1 &
  echo "• started $name (pid $!) → logs/$name.log"
}

# qdrant (native binary)
if ! curl -sf localhost:6333/healthz >/dev/null 2>&1; then
  QDRANT__STORAGE__STORAGE_PATH="$ROOT/qdrant-storage" ./bin/qdrant > logs/qdrant.log 2>&1 &
  echo "• started qdrant (pid $!) → logs/qdrant.log"
else echo "• qdrant already up"; fi

sleep 3

# ingestion + retriever (share .venv-ingestion)
if ! curl -sf localhost:8101/health >/dev/null 2>&1; then
  bash services/ingestion/run-host.sh > logs/ingestion.log 2>&1 &
  echo "• started ingestion (pid $!) → logs/ingestion.log"
else echo "• ingestion already up"; fi

if ! curl -sf localhost:8100/health >/dev/null 2>&1; then
  bash services/retriever/run-host.sh > logs/retriever.log 2>&1 &
  echo "• started retriever (pid $!) → logs/retriever.log"
else echo "• retriever already up"; fi

# web (next dev)
if ! curl -sf localhost:3000 >/dev/null 2>&1; then
  # Production build → next start (much faster page loads than `next dev`).
  ( cd web && npm run build > "$ROOT/logs/web-build.log" 2>&1 && npm run start > "$ROOT/logs/web.log" 2>&1 & )
  echo "• building + starting web (production) → logs/web.log"
else echo "• web already up"; fi

echo
echo "CC-RAGOS host-native. Open http://localhost:3000"
echo "Stop with: pkill -f 'uvicorn app.main'; pkill -f 'bin/qdrant'; pkill -f 'next start'"
