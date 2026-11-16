#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required=(MONGODB_URI SESSION_SECRET ROOT_SUPERUSER_INITIAL_PASSWORD ENCRYPTION_MASTER_KEY APP_URL CORS_ALLOWED_ORIGINS LOGISTICS_SUPABASE_URL LOGISTICS_SUPABASE_SERVICE_ROLE_KEY)
missing=()
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then missing+=("$key"); fi
done
if (("${#missing[@]}" > 0)); then
  printf 'Missing production environment variables:\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

if [[ "${REQUIRE_OBJECT_STORAGE:-1}" == "1" ]]; then
  object_storage=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_CDN_URL)
  missing_storage=()
  for key in "${object_storage[@]}"; do
    if [[ -z "${!key:-}" ]]; then missing_storage+=("$key"); fi
  done
  if (("${#missing_storage[@]}" > 0)); then
    printf 'Missing persistent object-storage configuration (uploads otherwise use ephemeral local disk):\n' >&2
    printf '  - %s\n' "${missing_storage[@]}" >&2
    exit 1
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it before running this check." >&2
  exit 1
fi

bun install --no-save
bun run lint
bun run test:logistics
bun run test:hybrid
bun run test:privacy
bun run test:roles
bun run build
bun run build:workspace

echo "Production pre-deploy checks passed."
