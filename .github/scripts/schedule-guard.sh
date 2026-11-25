#!/usr/bin/env bash
# Decides whether this workflow run should scrape (D-084).
#
# GitHub cron is UTC-only and Canberra observes daylight saving, so the workflow schedules
# BOTH 06:00 UTC (= 17:00 AEDT) and 07:00 UTC (= 17:00 AEST) on Fridays; exactly one of them
# lands on 17:00 in Australia/Sydney (Canberra's zone). The other exits early here.
# Manual runs (workflow_dispatch) always go ahead.
#
# Usage: schedule-guard.sh <event_name>
# Test hook: NOW overrides the clock (anything `date -d` accepts, e.g. "2026-12-04T06:00:00Z").
# Writes run=true|false to $GITHUB_OUTPUT (when set) and prints it.
set -euo pipefail

event="${1:-schedule}"
now="${NOW:-now}"

if [ "$event" = "workflow_dispatch" ]; then
  run=true
  reason="manual run"
else
  hour="$(TZ=Australia/Sydney date -d "$now" +%H)"
  if [ "$hour" = "17" ]; then
    run=true
    reason="it is 17:00 in Canberra"
  else
    run=false
    reason="it is ${hour}:xx in Canberra, not 17:xx (the other DST cron handles Friday 5pm)"
  fi
fi

echo "run=$run ($reason)"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "run=$run" >> "$GITHUB_OUTPUT"; fi
