#!/usr/bin/env bash
# grade-recall-gpt.sh <reviewPath> <mutJson> <ids_csv>
# CROSS-FAMILY grader: feeds a code review + the injected-bug ground truth to GPT-5.5 via the local Codex CLI
# and prints one line per id: "<id>\tDETECTED" or "<id>\tMISSED". Used to check the opus grader for
# self-preference — compare these verdicts against grade-recall.js (opus) on the SAME reviews.
set -euo pipefail
REVIEW="$1"; MJSON="$2"; IDS="$3"

GT="$(node -e '
const fs = require("fs");
const [mj, ids] = [process.argv[1], process.argv[2]];
const d = JSON.parse(fs.readFileSync(mj, "utf8"));
for (const id of ids.split(",")) {
  const m = (d.mutations || []).find(x => x.id === id);
  if (m) console.log(`### id=${id} (class=${m.class})\nCorrect behavior the injected bug breaks: ${m.correct_behavior}\n`);
}
' "$MJSON" "$IDS")"

PROMPT="$(mktemp)"
{
  echo "You are a STRICT code-review grader. Below is a CODE REVIEW of a diff, then a list of BUGS that were"
  echo "deliberately injected into that diff (each with an id and the correct behavior it breaks)."
  echo "For EACH bug id, decide whether the REVIEW detected it. DETECTED means the review explicitly names the"
  echo "right code location AND describes that specific defect (not a vague or merely adjacent comment)."
  echo "Output ONLY one line per id, EXACTLY in the form:  <id><TAB>DETECTED   or   <id><TAB>MISSED"
  echo "No preamble, no other text."
  echo; echo "===== CODE REVIEW ====="; cat "$REVIEW"
  echo; echo "===== INJECTED BUGS ====="; printf '%s\n' "$GT"
} > "$PROMPT"

codex exec -s read-only --skip-git-repo-check -m gpt-5.5 -c model_reasoning_effort=high - < "$PROMPT" 2>/dev/null \
  | grep -iE 'DETECTED|MISSED'
rm -f "$PROMPT"
