#!/usr/bin/env bash
# usage: eval/grade_case.sh <case-id> <arm>
# Grades the LAST bench.jsonl row for case x arm (EVAL.md §B4, hardened per §3):
#  - recall: truth match_regex first, sonnet FOUND/MISSED semantic fallback
#  - findings: truth-match = TP; EVERYTHING else (decoy-cited included) goes to the audit pile —
#    §3 MAJOR#8: no auto-FP by decoy citation; the pilot hand-audit (§3 MINOR#10) settles FP counts
#  - miss attribution (council arms): workflow-journal judge JSON via runId → PANEL|JUDGE|SYNTH (§3 MINOR#9:
#    semantic check, not regex-over-raw-answers)
# Appends one row to eval/results/grades.jsonl.
set -euo pipefail
E="$(cd "$(dirname "$0")" && pwd)"
CASE=${1:?case id}; ARM=${2:?arm}
CJ="$E/cases/$CASE/case.json"
ROW=$(jq -c --arg c "$CASE" --arg a "$ARM" 'select(.case==$c and .arm==$a)' "$E/results/bench.jsonl" | tail -1)
[ -n "$ROW" ] || { echo "no bench row for $CASE/$ARM" >&2; exit 1; }
REVIEW=$(printf '%s' "$ROW" | jq -r .review)
KIND=$(jq -r .kind "$CJ")

ask() { # $1=prompt -> sonnet's text answer
  claude -p "$1" --model sonnet --output-format json 2>/dev/null | jq -r '.result // empty'
}

found=null; miss_cause=null
if [ "$KIND" != clean ]; then
  RE=$(jq -r .truth.match_regex "$CJ")
  DESC=$(jq -r .truth.desc "$CJ"); TF=$(jq -r .truth.file "$CJ"); TL=$(jq -r .truth.lines "$CJ")
  if printf '%s' "$REVIEW" | grep -Eiq "$RE"; then
    found=true
  else
    V=$(ask "TRUTH: a seeded bug — ${DESC} — at ${TF}:${TL}.
REVIEW REPORT:
${REVIEW}

Did the review identify THIS specific bug — same root cause AND same code location/mechanism as the TRUTH? A review that flags OTHER issues (even real, even severe, even in the same diff) without identifying THIS one is MISSED. Same file alone is not enough; a vague adjacent worry is not enough. Answer with exactly one word: FOUND or MISSED.")
    case $V in *FOUND*) found=true;; *) found=false;; esac
  fi
  [ "$found" = null ] && found=false

  # miss attribution — only meaningful when a council judge row exists
  RID=$(printf '%s' "$ROW" | jq -r '.run_id // empty')
  if [ "$found" = false ] && [ -n "$RID" ]; then
    JF=$("$E/journal.sh" by-id "$RID" || true)
    J=$([ -n "$JF" ] && jq -c '.result.judge' "$JF" || true)
    if [ -n "$J" ] && [ "$J" != null ]; then
      A=$(ask "TRUTH: a seeded bug — ${DESC} — at ${TF}:${TL}. The final review MISSED it.
JUDGE JSON (per-list, entries are '<panelist>: <claim>'):
${J}

Where was it lost? Answer with exactly one word:
JUDGE  if the truth appears in invalidClaims (a panelist raised it and the judge killed it),
SYNTH  if the truth appears in consensus or uniqueInsights but was still absent from the final review,
PANEL  if no list contains it (no panelist raised it).")
      case $A in *JUDGE*) miss_cause=\"judge\";; *SYNTH*) miss_cause=\"synth\";; *) miss_cause=\"panel\";; esac
    else
      miss_cause=\"panel_unjoined\"
    fi
  fi
fi

# audit pile: every non-truth finding, with decoy citation flagged — graded by the human pilot pass
DECOYS=$(jq -c '.decoy_files // []' "$CJ")
TRUTH_LINE=$([ "$KIND" != clean ] && printf '%s at %s:%s' "$DESC" "$TF" "$TL" || echo 'NONE (clean-diff case)')
AUDIT=$(ask "TRUTH: ${TRUTH_LINE}
DECOY FILES (benign-by-construction edits): ${DECOYS}
REVIEW REPORT:
${REVIEW}

List every finding in the report that is NOT the truth bug. Output ONLY a JSON array (no fences), one object per finding: {\"head\": \"<first ~120 chars of the finding>\", \"cites_decoy_only\": true|false}. Output [] if none.")
AUDIT=$(printf '%s' "$AUDIT" | sed 's/^```json//; s/^```//; s/```$//' | jq -c '.' 2>/dev/null || echo '[]')

jq -cn --arg case "$CASE" --arg arm "$ARM" --arg kind "$KIND" \
  --argjson found "$found" --argjson miss_cause "${miss_cause:-null}" \
  --argjson audit "$AUDIT" --arg ts "$(date -u +%FT%TZ)" \
  '{case:$case, arm:$arm, kind:$kind, found:$found, miss_cause:$miss_cause,
    audit_pile:$audit, audited:false, ts:$ts}' >> "$E/results/grades.jsonl"
echo "case $CASE arm $ARM: found=$found miss_cause=${miss_cause:-n/a} audit_items=$(printf '%s' "$AUDIT" | jq length)"
