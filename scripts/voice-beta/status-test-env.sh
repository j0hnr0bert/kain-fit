#!/usr/bin/env bash
# Reports the current status of every voice-testing environment component.
# Never prints secret values — presence/non-empty only. Safe to run anytime,
# including when nothing is running.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== Secrets (presence/non-empty only) =="
for pair in "supabase/functions/.env.local:OPENAI_API_KEY" "supabase/functions/.env.local:VOICE_TRANSCRIPTION_ENABLED" ".env.local:SUPABASE_SERVICE_ROLE_KEY" ".env.local:SUPABASE_URL" ".env.local:VITE_SUPABASE_URL"; do
  FILE="${pair%%:*}"; VAR="${pair##*:}"
  if [ -f "$FILE" ]; then
    LINE=$(grep "^${VAR}=" "$FILE" || true)
    VAL="${LINE#${VAR}=}"
    [ -n "$VAL" ] && echo "  $FILE :: $VAR -> present" || echo "  $FILE :: $VAR -> MISSING/EMPTY"
  else
    echo "  $FILE -> file missing"
  fi
done

echo ""
echo "== Docker/OrbStack =="
docker info >/dev/null 2>&1 && echo "  running" || echo "  NOT running"

echo ""
echo "== Local Supabase containers =="
docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep supabase || echo "  none running"

echo ""
echo "== Edge Function server =="
pgrep -f "functions serve" >/dev/null 2>&1 && echo "  running" || echo "  not running"

echo ""
echo "== Frontend dev server =="
pgrep -f "vite dev" >/dev/null 2>&1 && echo "  running" || echo "  not running"

echo ""
echo "== Tailscale =="
if command -v tailscale >/dev/null 2>&1; then
  STATE=$(tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['BackendState'])" 2>/dev/null || echo "unknown")
  echo "  backend state: $STATE"
  if [ "$STATE" = "Running" ]; then
    tailscale status --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('  self:', d['Self']['DNSName'].rstrip('.'), '| online =', d['Self'].get('Online'))
for p in (d.get('Peer') or {}).values():
    print('  peer:', p.get('DNSName','').rstrip('.'), '|', p.get('OS'), '| online =', p.get('Online'))
"
  fi
  echo "  serve mappings:"
  tailscale serve status 2>&1 | sed 's/^/    /'
else
  echo "  tailscale CLI not found"
fi

echo ""
echo "== End-to-end reachability (only meaningful if Tailscale is mapped) =="
if command -v tailscale >/dev/null 2>&1; then
  HOSTNAME=$(tailscale status --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || echo "")
  if [ -n "$HOSTNAME" ]; then
    FSTATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://${HOSTNAME}/" 2>/dev/null)
    GSTATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X OPTIONS "https://${HOSTNAME}:8443/functions/v1/transcribe-voice" 2>/dev/null)
    echo "  frontend (https://${HOSTNAME}/): HTTP $FSTATUS"
    echo "  gateway  (https://${HOSTNAME}:8443/...): HTTP $GSTATUS"
  fi
fi
