#!/usr/bin/env bash
# usage: eval/run_case.sh <case-id> <full|nogpt|duo|duo-merged|solo|solo-k>
# Runs ONE case x ONE arm (EVAL.md §B3, hardened per §3): scratch clone with SCRUBBED git history,
# seeded working-tree diff, arm-specific review, wall-clock + cost + gpt_ran recorded.
# Appends one row to eval/results/bench.jsonl. Review text is recovered via file Write (not stdout
# relay — same relay-bail class this repo fixed twice already, cf. CHANGELOG 0.1.12).
set -euo pipefail
E="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$E")"
WF="$ROOT/workflows/fusion-review.js"
CASE=${1:?case id}; ARM=${2:?arm}
CJ="$E/cases/$CASE/case.json"
[ -f "$CJ" ] || { echo "no case $CJ" >&2; exit 1; }
SRC=$(jq -r .repo "$CJ"); REF=$(jq -r .ref "$CJ"); KIND=$(jq -r .kind "$CJ")
mkdir -p "$E/results"
K=${SOLO_K:-3}   # solo-k sample count; recalibrate against pilot-measured full-arm cost (§3 FATAL#1)

# §3 FATAL#1: equalized prompt strength — union of the role seats' dimension checklists + GPT's sections.
CHECKLIST='Cover ALL of: (1) correctness & regression risks — inverted logic, off-by-one, async/await misuse, swallowed errors, fail-open defaults; (2) hidden coupling & edge cases; (3) missing tests and how to verify; (4) maintainability — style consistency, API/contract breaks, migration needs; (5) overengineering & out-of-scope changes.'
FRAMING='Review the following working-tree diff. Be terse and actionable; ground every finding in a file/line or a concrete behavior. Do not suggest unrelated cleanup. Report every real issue under a "## Findings" heading as: Severity / File / Issue / Suggested fix.'

build_scratch() {  # fresh scratch repo with seeded diff; echoes canonical path
  local W; W=$(mktemp -d); W=$(cd "$W" && pwd -P)
  git clone -q --local "$SRC" "$W"
  git -C "$W" checkout -q "$REF"
  # §3 FATAL#3: scrub history so the fix commit / repo provenance can't leak the truth
  rm -rf "$W/.git"
  git -C "$W" init -q
  git -C "$W" add -A
  git -C "$W" -c user.email=bench@local -c user.name=bench commit -qm init >/dev/null
  git -C "$W" apply "$E/cases/$CASE/bug.patch"
  echo "$W"
}

run_claude() {  # $1=cwd $2=prompt $3=model('' = default) -> envelope json on stdout
  local cwd=$1 prompt=$2 model=$3 out
  out=$(cd "$cwd" && claude -p "$prompt" ${model:+--model "$model"} \
    --output-format json --dangerously-skip-permissions 2>/dev/null) || true
  printf '%s' "$out"
}

attempt=0; gpt_ran=null; excluded_d1=false; run_id=null
while :; do
  attempt=$((attempt+1))
  W=$(build_scratch)
  T0=$(date +%s)
  case $ARM in
    full|nogpt|duo|duo-merged)
      # duo panel is the default since 0.2.0 (roles:true opts back into the role panel); merged
      # judge+synthesize is the default since 0.3.0. The historical full/nogpt/duo arms are TWO-CALL
      # pipeline arms, so they pin splitSynth:true (no-op against pre-0.3.0 workflows, which are split
      # by default); duo-merged keeps mergedSynth:true (no-op post-0.3.0, opts in pre-0.3.0). duo:true
      # is the pre-0.2.0-compat legacy flag, kept so duo vs duo-merged differ by exactly one axis.
      ARGS='{"roles":true,"splitSynth":true}'; [ "$ARM" = nogpt ] && ARGS='{"roles":true,"noGpt":true,"splitSynth":true}'
      [ "$ARM" = duo ] && ARGS='{"duo":true,"splitSynth":true}'
      [ "$ARM" = duo-merged ] && ARGS='{"duo":true,"mergedSynth":true}'
      RV="$W/.fusion-bench-review.md"
      PROMPT="Call the Workflow tool EXACTLY ONCE with {\"scriptPath\":\"$WF\",\"args\":$ARGS}. Do not review the code yourself. Then use the Write tool to save the returned 'review' field EXACTLY, in full, to $RV . Reply with only the single word DONE."
      ENV=$(run_claude "$W" "$PROMPT" "")
      REVIEW=$(cat "$RV" 2>/dev/null || true)
      ;;
    solo)
      D=$(git -C "$W" diff)
      ENV=$(run_claude "$W" "$FRAMING $CHECKLIST

DIFF:
$D" opus)
      REVIEW=$(printf '%s' "$ENV" | jq -r '.result // empty')
      ;;
    solo-k)
      D=$(git -C "$W" diff)
      COST_K=0; REVS=""
      for i in $(seq 1 "$K"); do
        EK=$(run_claude "$W" "$FRAMING $CHECKLIST

DIFF:
$D" opus)
        REVS="$REVS
=== REVIEW $i ===
$(printf '%s' "$EK" | jq -r '.result // empty')"
        COST_K=$(echo "$COST_K + $(printf '%s' "$EK" | jq -r '.total_cost_usd // 0')" | bc)
      done
      ENV=$(run_claude "$W" "Merge these $K independent reviews of the SAME diff into ONE deduplicated findings report. Union, not intersection: keep every distinct issue any review raised; collapse duplicates. Keep the format: a '## Findings' heading, each finding as Severity / File / Issue / Suggested fix.
$REVS" sonnet)
      REVIEW=$(printf '%s' "$ENV" | jq -r '.result // empty')
      ;;
    *) echo "unknown arm $ARM" >&2; exit 1;;
  esac
  T1=$(date +%s)
  COST=$(printf '%s' "$ENV" | jq -r '.total_cost_usd // 0')
  [ "$ARM" = solo-k ] && COST=$(echo "$COST + $COST_K" | bc)

  # §3 MAJOR#7 + ablation-integrity assert: join the run's workflow journal (eval/journal.sh) and require BOTH
  # (a) the workflow actually ran the REQUESTED arm (catches args silently dropped/stringified — this
  # exact failure corrupted the first pilot: every nogpt/duo run silently executed as full), and
  # (b) for full/duo, that the GPT seat really ran. Violation → rerun (≤3 attempts), else excluded.
  if [ "$ARM" = full ] || [ "$ARM" = duo ] || [ "$ARM" = duo-merged ] || [ "$ARM" = nogpt ]; then
    J=$("$E/journal.sh" latest "$W" fusion-review || true)
    gpt_ran=$([ -n "$J" ] && jq -r '.result.stats.gpt_ran // ((.result.panel // []) | any(startswith("gpt-")))' "$J" || echo false)
    run_id=$([ -n "$J" ] && jq -r '.runId // null' "$J" || echo null)
    tel_arm=$([ -n "$J" ] && jq -r '.result.stats.arm // "none"' "$J" || echo none)
    bad=""
    [ "$tel_arm" != "$ARM" ] && bad="journal arm=$tel_arm != requested $ARM"
    if [ -z "$bad" ] && { [ "$ARM" = full ] || [ "$ARM" = duo ] || [ "$ARM" = duo-merged ]; } && [ "$gpt_ran" != true ]; then
      bad="gpt_ran=$gpt_ran"
    fi
    if [ -n "$bad" ] && [ $attempt -lt 3 ]; then
      echo "case $CASE arm $ARM attempt $attempt: $bad — retrying" >&2
      rm -rf "$W"; continue
    fi
    [ -n "$bad" ] && { excluded_d1=true; echo "case $CASE arm $ARM: STILL INVALID ($bad) — excluded_d1" >&2; }
    [ "$gpt_ran" = true ] && gpt_ran=true || gpt_ran=false
  fi

  # relay guard: council review must have real content; one extra attempt total (shared with gpt guard)
  if { [ "$ARM" = full ] || [ "$ARM" = nogpt ] || [ "$ARM" = duo ] || [ "$ARM" = duo-merged ]; } && [ "${#REVIEW}" -lt 200 ] && [ $attempt -lt 3 ]; then
    echo "case $CASE arm $ARM attempt $attempt: review too short (${#REVIEW}) — retrying" >&2
    rm -rf "$W"; continue
  fi
  break
done

jq -cn --arg case "$CASE" --arg arm "$ARM" --arg kind "$KIND" \
  --argjson attempt "$attempt" --argjson wall "$((T1-T0))" --argjson cost "${COST:-0}" \
  --argjson gpt_ran "$gpt_ran" --argjson excl "$excluded_d1" --arg rid "${run_id:-}" \
  --arg review "$REVIEW" --arg ts "$(date -u +%FT%TZ)" \
  '{case:$case, arm:$arm, kind:$kind, attempt:$attempt, wall_s:$wall, cost:$cost,
    gpt_ran:$gpt_ran, excluded_d1:$excl, run_id:(if $rid=="" or $rid=="null" then null else $rid end),
    ts:$ts, review:$review}' >> "$E/results/bench.jsonl"
rm -rf "$W"
echo "case $CASE arm $ARM: done (wall $((T1-T0))s, cost \$$COST, gpt_ran=$gpt_ran, review ${#REVIEW} chars)"
