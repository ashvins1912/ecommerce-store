#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  echo "Dependencies are missing. Run 'npm install' or 'bun install' first." >&2
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  package_manager=(bun run)
elif command -v npm >/dev/null 2>&1; then
  package_manager=(npm run)
else
  echo "Install Bun or npm to run the development services." >&2
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
  local name="$1"
  local script="$2"
  shift
  ( printf '[dev:all] starting %s\n' "$name"; exec "${package_manager[@]}" "$script" ) &
  pids+=("$!")
}

start_service "Main API / customer storefront" dev
start_service "Customer web UI" dev:customer
start_service "Provider dashboard UI" dev:provider
start_service "Payment API" dev:payment
start_service "Shipping API" dev:shipping

if [[ "${START_LOGISTICS_WORKER:-0}" == "1" ]]; then
  start_service "Logistics worker" logistics:worker
else
  echo "[dev:all] logistics worker disabled; set START_LOGISTICS_WORKER=1 to start it."
fi

echo "[dev:all] Starting main, payment and shipping APIs plus customer and provider UIs."
echo "[dev:all] Press Ctrl+C to stop all selected services."
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      if wait "$pid"; then status=0; else status=$?; fi
      echo "[dev:all] a service exited (status $status); stopping remaining services." >&2
      exit "$status"
    fi
  done
  sleep 1
done
