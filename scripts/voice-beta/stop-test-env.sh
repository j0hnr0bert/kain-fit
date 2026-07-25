#!/usr/bin/env bash
# Tears down the entire local voice-testing environment: Tailscale HTTPS
# mappings, frontend dev server, Edge Function server, and local Supabase.
# Safe to re-run — every step is a no-op if already stopped.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== Tailscale serve mappings =="
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve reset 2>&1
  tailscale serve status 2>&1
else
  echo "  tailscale CLI not found, skipping"
fi

echo ""
echo "== Frontend dev server =="
pkill -f "vite dev" 2>/dev/null && echo "  stopped" || echo "  was not running"

echo ""
echo "== Edge Function server =="
pkill -f "functions serve" 2>/dev/null && echo "  stopped" || echo "  was not running"

sleep 2
pgrep -f "vite dev" >/dev/null 2>&1 && { echo "  WARNING: frontend still running, force-killing"; pkill -9 -f "vite dev"; }
pgrep -f "functions serve" >/dev/null 2>&1 && { echo "  WARNING: functions server still running, force-killing"; pkill -9 -f "functions serve"; }

echo ""
echo "== Local Supabase (project-scoped) =="
supabase stop 2>&1

echo ""
echo "== Final confirmation: nothing left running =="
docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep supabase && echo "  WARNING: containers still up" || echo "  OK: zero containers running"
pgrep -f "vite dev|functions serve" >/dev/null 2>&1 && echo "  WARNING: a process is still running" || echo "  OK: no frontend/Edge Function processes"
echo "  OK: Tailscale serve reset (confirm 'No serve config' above)"
