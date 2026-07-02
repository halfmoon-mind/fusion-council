#!/usr/bin/env bash
# usage: eval/ack.sh y|n [note...]
# Record whether the LAST council run's output was acted on (online precision signal, EVAL.md §A).
set -euo pipefail
T="$HOME/.fusion-council/telemetry.jsonl"
[ -f "$T" ] || { echo "no telemetry at $T" >&2; exit 1; }
A="${1:-}"; case "$A" in y|n) ;; *) echo "usage: eval/ack.sh y|n [note...]" >&2; exit 1 ;; esac
shift || true
RID=$(jq -cR 'fromjson? // empty' "$T" | jq -rs '[.[] | select(.judge)] | last | (.run_id // .ts) // empty')
[ -n "$RID" ] || { echo "no run rows in telemetry" >&2; exit 1; }
jq -cn --arg ts "$(date -u +%FT%TZ)" --arg run "$RID" --arg a "$A" --arg note "$*" \
  '{ack: true, ts: $ts, run_id: $run, acted_on: $a, note: $note}' >> "$T"
echo "acked run $RID acted_on=$A"
