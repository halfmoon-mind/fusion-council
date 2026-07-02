#!/usr/bin/env bash
# run_mutants.sh — reconstruct each synthetic mutant leak-free (apply-mutant.sh from the live target repo HEAD) and
# run the requested variants over it, writing <mutid>_<variant>.json into $OUT. Also writes <mutid>.fix.patch
# (the reverse of the mutation = the correct code) as the grader reference. Sequential; prints timestamps.
set -uo pipefail
SCRATCH="${SCRATCH:-/tmp/fusion-bench}"; mkdir -p "$SCRATCH"
LIVE="${LIVE:?set LIVE=path to the target repo (mutations are proposed/applied against it)}"
BENCH="$(cd "$(dirname "$0")/.." && pwd)"
MUTS="$SCRATCH/mutations"
OUT="$SCRATCH/mutmatrix"; mkdir -p "$OUT"
APPLY="$BENCH/dataset/build/apply-mutant.sh"; RUN="$BENCH/driver/run_case.sh"

do_mut() {  # <jsonfile> <mutid> <variant...>
  local jf="$1" mid="$2"; shift 2
  local dir="$SCRATCH/mut_case_${mid}"
  if ! "$APPLY" "$LIVE" HEAD "$MUTS/$jf" "$mid" "$dir" >/dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] APPLY FAIL $mid"; return
  fi
  git -C "$dir" diff -R > "$OUT/${mid}.fix.patch"   # reverse mutation = correct code (grader ground truth)
  for v in "$@"; do
    echo "[$(date +%H:%M:%S)] START $mid $v"
    "$RUN" "$dir" "$v" > "$OUT/${mid}_${v}.json" 2> "$OUT/${mid}_${v}.err"
    echo "[$(date +%H:%M:%S)] END   $mid $v (bytes=$(wc -c < "$OUT/${mid}_${v}.json"))"
  done
}

# --- Edit the job list for YOUR synthetic mutations (generate them with dataset/build/propose-mutations.js).
#     $MUTS/<file>.json holds the proposed mutations; each id is one injected bug. Example: ---
#   do_mut mymutations.json some-mutation-id council single-opus
# do_mut perf_mut.json findByArtist-hasMore-comparison council single-opus
echo "[$(date +%H:%M:%S)] ALL_DONE"
