#!/usr/bin/env bash
# Run the retriever on the host (no Docker). Shares the .venv-ingestion venv.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

set -a
# shellcheck disable=SC1091
source .env
set +a
export QDRANT_URL="http://localhost:6333"   # native qdrant on host

exec .venv-ingestion/bin/uvicorn app.main:app \
  --app-dir services/retriever \
  --host 0.0.0.0 --port "${RETRIEVER_PORT:-8100}"
