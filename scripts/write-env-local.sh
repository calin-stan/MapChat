#!/usr/bin/env bash
# Writes .env.local from the running Supabase stack (Supbuddy-managed).
# Usage: pnpm db:env   (the stack must be running: Supbuddy app, or `start_supabase` over MCP)
#
# Safety: writes to a temp file in the same directory as .env.local (so the
# final `mv` is atomic), verifies all three required variables are present
# with non-empty values, and only then replaces .env.local. On any failure,
# the temp file is removed and any existing .env.local is left untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
TMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

if ! supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  | grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' \
  > "$TMP_FILE"
then
  echo "error: 'supabase status' failed, or did not produce the expected variables. Is the stack running ('pnpm db:status')? .env.local left untouched." >&2
  exit 1
fi

for VAR in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  VALUE="$(grep -E "^${VAR}=" "$TMP_FILE" | cut -d= -f2-)"
  if [ -z "$VALUE" ]; then
    echo "error: ${VAR} is missing or empty in 'supabase status' output. .env.local left untouched." >&2
    exit 1
  fi
done

mv "$TMP_FILE" "$ENV_FILE"
trap - EXIT

echo "Wrote ${ENV_FILE}:"
sed -E 's/(KEY=).*/\1<redacted>/' "$ENV_FILE"
