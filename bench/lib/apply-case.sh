#!/usr/bin/env bash
# Reconstruct ONE benchmark case as a fresh, LEAK-FREE git repo: a single neutral 'baseline'
# commit (so the reviewer cannot read the fix commit / its message from history) with the diff
# under review left UNCOMMITTED in the working tree. Prints the case dir as the last stdout line.
#
# Proven necessary (2026-07-01): reviewing at the fix commit let the council read the fix from
# `git log` and cite "revert of commit <sha>" + the commit message — a direct answer leak. A fresh
# single-commit repo removes all history (no `--all`/reflog leak either).
#
# Usage:
#   apply-case.sh <clone_repo> <fix_sha> <out_case_dir> [buggy|clean]
#     buggy (default): base = fix tree, reverse-apply the fix  -> reviewer sees the BUG (removal diff).
#                       NOTE: reverted-fix is an OPTIMISTIC UPPER BOUND (correct code visibly deleted).
#     clean (FP set):  base = parent tree, forward-apply the fix -> reviewer sees a CORRECT change;
#                       any Severity>=medium finding here counts as a false positive.
set -euo pipefail
CLONE="$1"; FIX="$2"; OUT="$3"; MODE="${4:-buggy}"

FIXPATCH="$(mktemp)"
git -C "$CLONE" diff "${FIX}^" "$FIX" > "$FIXPATCH"

case "$MODE" in
  clean|--clean) BASE="${FIX}^"; DIR="" ;;   # forward-apply the fix onto the parent
  *)             BASE="$FIX";    DIR="-R" ;;  # reverse-apply the fix onto the fix tree
esac

rm -rf "$OUT"; mkdir -p "$OUT"
git -C "$CLONE" archive "$BASE" | tar -x -C "$OUT"
git -C "$OUT" init -q
git -C "$OUT" add -A
git -C "$OUT" -c user.email=bench@local -c user.name=bench commit -q -m baseline
git -C "$OUT" apply $DIR "$FIXPATCH"
rm -f "$FIXPATCH"

# guards: exactly one commit (no leak) and a non-empty diff to review
[ "$(git -C "$OUT" rev-list --count --all)" = "1" ] || { echo "LEAK: case dir has >1 commit" >&2; exit 1; }
if git -C "$OUT" diff --quiet; then echo "EMPTY: no diff produced (patch applied cleanly to itself?)" >&2; exit 1; fi
echo "$OUT"
