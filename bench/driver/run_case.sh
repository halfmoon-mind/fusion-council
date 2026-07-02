#!/usr/bin/env bash
# run_case.sh <case_dir> <variant>
#   Runs one reviewer VARIANT over the leak-free case repo (cwd = case_dir, so the real capture reads
#   its git diff) and prints the reviewer's STRUCTURED return (review + coverage), delimited by markers.
#   variant: council | claude-only | single-opus
#
# Structured capture: we invoke the Workflow tool directly (NOT the /fusion-council:fusion-review skill,
# whose SKILL.md makes the outer agent paraphrase the result into chat prose, losing per-finding
# "Raised by"). The prompt forces the outer agent to print the returned `review`/`coverage` verbatim.
set -euo pipefail
CASE="$1"; VARIANT="$2"
CACHE="$HOME/.claude/plugins/cache/fusion-council/fusion-council/0.1.9/workflows/fusion-review.js"
BENCH="$(cd "$(dirname "$0")/.." && pwd)"

case "$VARIANT" in
  council)     SP="$CACHE"; ARGS='{}' ;;
  # claude-only nests the real workflow with seats baked in via code (a deterministic wrapper) rather than
  # relying on the outer -p agent to forward args — which was observed dropping seats and letting GPT run.
  claude-only) SP="$BENCH/variants/claude-only.js"; ARGS='{}' ;;   # council minus the GPT seat (H2)
  single-opus) SP="$BENCH/variants/single-opus.js"; ARGS='{}' ;;
  *) echo "unknown variant: $VARIANT" >&2; exit 1 ;;
esac

read -r -d '' PROMPT <<EOF || true
Use the Workflow tool exactly ONCE with scriptPath '$SP' and args $ARGS. Let it run to completion (it
spawns its own subagents; allow them). When it returns an object, print EXACTLY the following and nothing
else — no preamble, no summary of your own, no closing remark:
===REVIEW===
<the returned object's "review" field, verbatim>
===COVERAGE===
<the returned object's "coverage" field, verbatim>
===END===
EOF

( cd "$CASE" && claude -p "$PROMPT" \
    --allowedTools Read Glob Grep Bash Workflow Task \
    --output-format json )
