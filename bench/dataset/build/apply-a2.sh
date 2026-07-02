#!/usr/bin/env bash
# apply-a2.sh <live> <feature_sha> <out> <mutjson> <ids> [<mutjson2> <ids2> ...]
# Reconstruct a large REAL feature as an addition-framed, LEAK-FREE diff: baseline (single 'baseline' commit)
# = the feature's PARENT tree, then the feature is applied UNSTAGED and the given mutations are buried inside
# it. `git add -N` (intent-to-add) makes NEW feature files show up in `git diff` (the shipped capture reads
# plain `git diff`, which otherwise omits untracked files). The reviewer sees the whole feature diff with the
# injected bug hidden in the new code, and no correct reference exists (parent lacks the feature). Prints out.
set -euo pipefail
LIVE="$1"; FEAT="$2"; OUT="$3"; shift 3
PARENT="$(git -C "$LIVE" rev-parse "${FEAT}^")"

rm -rf "$OUT"; mkdir -p "$OUT"
git -C "$LIVE" archive "$PARENT" | tar -x -C "$OUT"
git -C "$OUT" init -q; git -C "$OUT" add -A
git -C "$OUT" -c user.email=bench@local -c user.name=bench commit -q -m baseline
git -C "$LIVE" diff "$PARENT" "$FEAT" | git -C "$OUT" apply --whitespace=nowarn

while [ "$#" -ge 2 ]; do
  MJSON="$1"; IDS="$2"; shift 2
  node - "$MJSON" "$IDS" "$OUT" <<'NODE'
const fs = require('fs');
const [ , , mjson, ids, out ] = process.argv;
const data = JSON.parse(fs.readFileSync(mjson, 'utf8'));
const rel = data.filePath.replace(/^.*\/((apps|packages|tools)\/.*)$/, '$1');
const fp = out + '/' + rel;
let src = fs.readFileSync(fp, 'utf8');
for (const id of ids.split(',')) {
  const m = data.mutations.find(x => x.id === id);
  if (!m) { console.error('no mutation id ' + id); process.exit(1); }
  const n = src.split(m.find).length - 1;
  if (n !== 1) { console.error(`find occurs ${n} times (need 1) for ${id}`); process.exit(2); }
  src = src.replace(m.find, m.replace);
}
fs.writeFileSync(fp, src);
process.stderr.write(`buried ${ids.split(',').length} mutation(s) in ${rel}\n`);
NODE
done

git -C "$OUT" add -N .   # intent-to-add so NEW feature files appear in `git diff`
git -C "$OUT" diff --quiet && { echo "EMPTY diff" >&2; exit 3; }
echo "$OUT"
