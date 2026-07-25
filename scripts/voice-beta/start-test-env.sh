#!/usr/bin/env bash
# Starts the local voice-testing environment: OrbStack/Docker check, local
# Supabase, the transcribe-voice Edge Function, the frontend dev server, and
# a Tailscale HTTPS mapping restricted to your own tailnet.
#
# Never prints secret values — only presence/non-empty checks. Requires
# `supabase/functions/.env.local` and project-root `.env.local` to already
# exist (see docs/voice-beta/TEST_SESSION_RUNBOOK.md's preflight section for
# how those are created — this script does not create or modify them).
#
# Safe to re-run: each step is a no-op if already running.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FRONTEND_PORT=8080
GATEWAY_PORT=54321
FRONTEND_LOG=/tmp/voice-beta-frontend.log
FUNCTIONS_LOG=/tmp/voice-beta-functions.log

fail() { echo "FAIL: $1" >&2; exit 1; }
ok() { echo "OK: $1"; }

echo "== 1. Secret presence check (values never printed) =="
[ -f supabase/functions/.env.local ] || fail "supabase/functions/.env.local is missing — see the runbook's preflight section"
[ -f .env.local ] || fail ".env.local (project root) is missing — see the runbook's preflight section"
for pair in "supabase/functions/.env.local:OPENAI_API_KEY" "supabase/functions/.env.local:VOICE_TRANSCRIPTION_ENABLED" ".env.local:SUPABASE_SERVICE_ROLE_KEY" ".env.local:SUPABASE_URL"; do
  FILE="${pair%%:*}"; VAR="${pair##*:}"
  LINE=$(grep "^${VAR}=" "$FILE" || true)
  VAL="${LINE#${VAR}=}"
  [ -n "$VAL" ] || fail "$VAR is missing or empty in $FILE"
done
ok "required local secrets present and non-empty"

echo "== 2. Docker/OrbStack =="
docker info >/dev/null 2>&1 || fail "Docker/OrbStack is not running — start OrbStack first"
ok "Docker daemon healthy"

echo "== 3. Local Supabase =="
supabase start
ok "local Supabase up"

echo "== 4. Edge Function server =="
if pgrep -f "functions serve" >/dev/null 2>&1; then
  ok "already running"
else
  supabase functions serve transcribe-voice --env-file ./supabase/functions/.env.local --no-verify-jwt=false > "$FUNCTIONS_LOG" 2>&1 &
  sleep 5
  pgrep -f "functions serve" >/dev/null 2>&1 || fail "Edge Function server did not start — check $FUNCTIONS_LOG"
  ok "started"
fi

echo "== 5. Frontend dev server =="
if pgrep -f "vite dev" >/dev/null 2>&1; then
  ok "already running"
else
  bun run dev > "$FRONTEND_LOG" 2>&1 &
  sleep 6
  pgrep -f "vite dev" >/dev/null 2>&1 || fail "frontend dev server did not start — check $FRONTEND_LOG"
  ok "started"
fi

echo "== 6. Tailscale =="
command -v tailscale >/dev/null 2>&1 || fail "tailscale CLI not found — install it first"
STATE=$(tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['BackendState'])")
[ "$STATE" = "Running" ] || fail "Tailscale is not logged in (state: $STATE) — log in via the Tailscale app first"
HOSTNAME=$(tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
ok "Tailscale logged in, hostname: $HOSTNAME"

echo "== 7. Tailscale HTTPS mapping (tailnet-only — never public) =="
tailscale serve --bg --https=443 "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null
tailscale serve --bg --https=8443 "http://127.0.0.1:${GATEWAY_PORT}" >/dev/null
ok "mapped"

echo "== 8. Verify end-to-end reachability =="
FRONTEND_URL="https://${HOSTNAME}/"
GATEWAY_URL="https://${HOSTNAME}:8443/functions/v1/transcribe-voice"
FSTATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$FRONTEND_URL")
GSTATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X OPTIONS "$GATEWAY_URL")
[ "$FSTATUS" = "200" ] || fail "frontend not reachable via Tailscale (got $FSTATUS)"
[ "$GSTATUS" = "200" ] || fail "gateway not reachable via Tailscale (got $GSTATUS)"
ok "both endpoints return 200"

echo ""
echo "########################################"
echo "Ready. Give the tester this URL:"
echo ""
echo "  $FRONTEND_URL"
echo ""
echo "Restricted to your own tailnet devices only — not publicly reachable."
echo "Run scripts/voice-beta/status-test-env.sh anytime to re-check."
echo "Run scripts/voice-beta/stop-test-env.sh when the session ends."
echo "########################################"
