#!/usr/bin/env bash
# usage: eval/journal.sh latest <cwd> [workflowName]   -> newest journal of that workflow for a project cwd
#        eval/journal.sh by-id <runId>                 -> the journal with that runId
# The harness writes one journal per Workflow run at
#   ~/.claude/projects/<cwd with / and . mapped to ->/<session>/workflows/wf_*.json
# holding result.{judge,panel,stats}, durationMs, totalTokens, status and per-seat progress. Since 0.5.0
# it IS the council's telemetry (the sonnet append seat is gone); analyze/run_case/grade_case read it.
set -euo pipefail
P="$HOME/.claude/projects"
case "${1:-}" in
  latest)
    D="$P/$(printf '%s' "${2:?cwd}" | sed 's#[/.]#-#g')"
    ls -t "$D"/*/workflows/wf_*.json 2>/dev/null | while read -r f; do
      jq -e --arg w "${3:-fusion-review}" 'select(.workflowName==$w)' "$f" >/dev/null 2>&1 && { echo "$f"; break; }
    done ;;
  by-id) grep -l -m1 "\"runId\": *\"${2:?runId}\"" "$P"/*/*/workflows/wf_*.json 2>/dev/null | head -1 ;;
  *) echo "usage: $0 latest <cwd> [workflowName] | by-id <runId>" >&2; exit 1 ;;
esac
