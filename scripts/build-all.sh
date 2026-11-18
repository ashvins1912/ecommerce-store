#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -x ./node_modules/.bin/vite || ! -x ./node_modules/.bin/esbuild ]]; then
  echo "Dependencies are missing. Run bun install from the repository root." >&2
  exit 1
fi

echo "[build:all] customer storefront"
./node_modules/.bin/vite build --config customer-web/vite.config.ts

echo "[build:all] provider portal"
./node_modules/.bin/vite build --config provider-portal/vite.config.ts

echo "[build:all] API"
./node_modules/.bin/esbuild api/src/entry.ts --bundle --platform=node --format=esm --packages=external --target=node22 --outfile=api/dist/entry.js

echo "[build:all] payment service"
./node_modules/.bin/esbuild payment-service/src/entry.ts --bundle --platform=node --format=esm --packages=external --target=node22 --outfile=payment-service/dist/entry.js

echo "[build:all] shipping service"
./node_modules/.bin/esbuild shipping-service/src/entry.ts --bundle --platform=node --format=esm --packages=external --target=node22 --outfile=shipping-service/dist/entry.js

echo "[build:all] all child projects built successfully"
