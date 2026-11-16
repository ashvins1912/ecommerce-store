#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install Bun, then run: bun install" >&2
  exit 1
fi
MODE="${1:-dev}"
case "$MODE" in
  dev) exec bun run dev ;;
  start) exec bun run start ;;
  build) exec bun run build ;;
  *)
    echo "Usage: bun run start:app [dev|start|build]" >&2
    exit 2
    ;;
esac
