#!/usr/bin/env bash
# Restart the full CC-RAGOS stack: kill anything on the project ports, then start fresh.
# Services: qdrant :6333, ingestion :8101, retriever :8100, web :3000.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORTS=(3000 8100 8101 6333)   # web, retriever, ingestion, qdrant (web first so it stops erroring while APIs restart)
NAMES=(web retriever ingestion qdrant)

echo "== Stopping anything on project ports =="
for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}" name="${NAMES[$i]}"
  pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "• $name (:$port) — killing pid(s): $(echo "$pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  else
    echo "• $name (:$port) — nothing running"
  fi
done

# Give processes a moment to exit gracefully, then force-kill stragglers.
sleep 2
for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}" name="${NAMES[$i]}"
  pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "• $name (:$port) — still up, force-killing"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
done

# Wait until every port is actually free (max ~10s).
for _ in $(seq 1 20); do
  busy=0
  for port in "${PORTS[@]}"; do
    lsof -ti "tcp:$port" >/dev/null 2>&1 && busy=1
  done
  [[ "$busy" == 0 ]] && break
  sleep 0.5
done

echo
echo "== Starting fresh =="
"$ROOT/scripts/start-host.sh"

echo
echo "== Waiting for services to come up =="
wait_for() { # name, url, max_seconds
  local name="$1" url="$2" max="$3" i
  for i in $(seq 1 "$max"); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then echo "• $name — up"; return 0; fi
    sleep 1
  done
  echo "✗ $name — NOT up after ${max}s (check logs/$name.log)"; return 1
}

fail=0
wait_for qdrant    "localhost:6333/healthz" 30  || fail=1
wait_for ingestion "localhost:8101/health"  60  || fail=1
wait_for retriever "localhost:8100/health"  60  || fail=1
echo "• web — building (production), can take 1-2 min..."
wait_for web       "localhost:3000"         240 || fail=1

echo
if [[ "$fail" == 0 ]]; then
  echo "✅ All services up. Open http://localhost:3000"
else
  echo "⚠️  Some services failed — check the logs/ directory."
  exit 1
fi
