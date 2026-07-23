#!/usr/bin/env bash
# Run the ingestion service on the host (Docling in a venv, no Docker).
# Stores/retriever/web stay in Docker; Qdrant is reached via localhost.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Load .env, then override host-specific values.
set -a
# shellcheck disable=SC1091
source .env
set +a
export QDRANT_URL="http://localhost:6333"   # docker qdrant is published on localhost

exec .venv-ingestion/bin/uvicorn app.main:app \
  --app-dir services/ingestion \
  --host 0.0.0.0 --port "${INGESTION_PORT:-8101}"
