#!/usr/bin/env bash
# run_matrix.sh — reconstruct each (case, kind) leak-free and run the requested variants over it,
# writing <sha>_<kind>_<variant>.json into $OUT. Sequential (reliability over speed); prints timestamps.
# Edit the job list at the bottom. Requires: $SCRATCH and $CLONE exported or set below.
set -uo pipefail
SCRATCH="${SCRATCH:-/tmp/fusion-bench}"; mkdir -p "$SCRATCH"
CLONE="${CLONE:?set CLONE=path to a throwaway clone of the target repo}"
BENCH="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$SCRATCH/matrix"; mkdir -p "$OUT"
APPLY="$BENCH/lib/apply-case.sh"; RUN="$BENCH/driver/run_case.sh"

do_case() {   # <sha> <kind:buggy|clean> <variant...>
  local sha="$1" kind="$2"; shift 2
  local dir="$SCRATCH/mc_${sha}_${kind}"
  if ! "$APPLY" "$CLONE" "$sha" "$dir" "$kind" >/dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] APPLY FAIL $sha $kind"; return
  fi
  for v in "$@"; do
    echo "[$(date +%H:%M:%S)] START $sha $kind $v"
    "$RUN" "$dir" "$v" > "$OUT/${sha}_${kind}_${v}.json" 2> "$OUT/${sha}_${kind}_${v}.err"
    echo "[$(date +%H:%M:%S)] END   $sha $kind $v (bytes=$(wc -c < "$OUT/${sha}_${kind}_${v}.json"))"
  done
}

# --- Edit the job list for YOUR repo's single-purpose fix commits (reverted-fix reconstruction). Example: ---
#   do_case <fix_sha> buggy council claude-only single-opus   # buggy = reverse the fix (bug reintroduced)
#   do_case <fix_sha> clean  council single-opus               # clean  = apply the fix (false-positive set)
# do_case abc1234 buggy council single-opus
echo "[$(date +%H:%M:%S)] ALL_DONE"
