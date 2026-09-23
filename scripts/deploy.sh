#!/usr/bin/env bash
# scripts/deploy.sh — deploy the Visa Advisor Cloudflare Worker.
#
# What it does:
#   1. cd into worker/
#   2. npm ci
#   3. if LLM_API_KEY wrangler secret is missing, prompt to set it
#   4. wrangler deploy, capture the workers.dev URL
#   5. print a one-liner to paste into visa-advisor/js/api.js
#
# Idempotent — safe to re-run after edits to worker/src/index.js or wrangler.toml.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$ROOT_DIR/worker"

if [[ ! -d "$WORKER_DIR" ]]; then
  echo "✗ worker/ not found at $WORKER_DIR" >&2
  exit 1
fi

cd "$WORKER_DIR"

echo "→ Installing worker dependencies..."
npm ci

# wrangler secret list returns non-zero when nothing is set; tolerate that.
echo "→ Checking wrangler auth..."
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "  (using CLOUDFLARE_API_TOKEN from env)"
  export WRANGLER_API_TOKEN="$CLOUDFLARE_API_TOKEN"
elif [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  export WRANGLER_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
fi

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "✗ Not logged in to wrangler." >&2
  echo "  Either set CLOUDFLARE_API_TOKEN in env, or run: npx wrangler login" >&2
  exit 1
fi

echo "→ Checking LLM_API_KEY secret..."
# Match either "name": "LLM_API_KEY" (JSON form) or "LLM_API_KEY" alone (table form)
if npx wrangler secret list 2>/dev/null | grep -qE '"name":[[:space:]]*"LLM_API_KEY"|^[[:space:]]*LLM_API_KEY[[:space:]]*$'; then
  echo "  (LLM_API_KEY already set — leaving it alone. To rotate, run: npx wrangler secret put LLM_API_KEY)"
else
  echo "→ LLM_API_KEY not set — prompting now."
  npx wrangler secret put LLM_API_KEY
fi

echo "→ Deploying worker..."
DEPLOY_OUTPUT="$(npx wrangler deploy 2>&1)"
echo "$DEPLOY_OUTPUT"

URL="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -Eo 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' | head -n1 || true)"

echo
if [[ -n "$URL" ]]; then
  echo "✓ Deployed."
  echo
  echo "Paste into visa-advisor/js/api.js:"
  echo "  const API_ENDPOINT = \"$URL\";"
else
  echo "✓ Deployed. Copy the workers.dev URL above into visa-advisor/js/api.js → API_ENDPOINT."
fi