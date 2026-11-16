#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install Bun, then run: bun install" >&2
  exit 1
fi
if [[ ! -d node_modules ]]; then
  echo "Dependencies are missing. Run 'bun install' first." >&2
  exit 1
fi

pids=()
cleanup() {
  local code=$?
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]:-}"; do wait "$pid" 2>/dev/null || true; done
  exit "$code"
}
trap cleanup INT TERM EXIT

start_service() {
  local name="$1"; shift
  ( printf '[dev:all] starting %s\n' "$name"; exec "$@" ) &
  pids+=("$!")
}
start_service "API" bun run dev
start_service "Customer web (4173)" bun run dev:customer
start_service "Provider Portal (4174)" bun run dev:provider
start_service "Seller Hub (4175)" bun run dev:seller

if [[ "${START_LOGISTICS_WORKER:-0}" == "1" ]]; then
  start_service "Logistics worker" bun run logistics:worker
else
  echo "[dev:all] logistics worker disabled; set START_LOGISTICS_WORKER=1 to start it."
fi

echo "[dev:all] selected services started. Press Ctrl+C to stop."
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"; status=$?
      echo "[dev:all] a service exited (status $status); stopping remaining services." >&2
      exit "$status"
    fi
  done
  sleep 1
done
