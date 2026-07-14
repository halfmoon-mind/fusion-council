#!/usr/bin/env bash
# usage: eval/run_bench.sh [arms...]   (default: full nogpt duo solo solo-k)
# Sequential double loop over eval/cases/* x arms; run + grade each. Pilot-friendly: rerun-safe
# (bench.jsonl/grades.jsonl append; grade_case reads the LAST row per case+arm).
set -euo pipefail
E="$(cd "$(dirname "$0")" && pwd)"
ARMS=("${@:-full nogpt duo solo solo-k}"); [ $# -gt 0 ] && ARMS=("$@") || ARMS=(full nogpt duo solo solo-k)
G="$E/results/grades.jsonl"
for CJ in "$E"/cases/*/case.json; do
  CASE=$(jq -r .id "$CJ")
  for ARM in "${ARMS[@]}"; do
    # resume-safe: a case x arm already graded is done — restarts never re-spend
    if [ -f "$G" ] && jq -e --arg c "$CASE" --arg a "$ARM" 'select(.case==$c and .arm==$a)' "$G" | grep -q .; then
      echo "=== $CASE / $ARM === (already graded, skip)"; continue
    fi
    echo "=== $CASE / $ARM ==="
    "$E/run_case.sh" "$CASE" "$ARM"
    "$E/grade_case.sh" "$CASE" "$ARM"
  done
done
echo "bench done → $E/results/bench.jsonl, grades.jsonl"
