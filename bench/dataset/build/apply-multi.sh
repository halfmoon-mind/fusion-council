#!/usr/bin/env bash
# apply-multi.sh <src> <ref> <out_dir> <mutations_json> <id1,id2,...> [<mutations_json2> <ids2> ...]
# Apply MULTIPLE find->replace mutations into ONE leak-free baseline tree -> a large multi-bug diff.
# Prints <out_dir>. Each mutations_json's ids all target that json's file; multiple jsons = multiple files.
set -euo pipefail
SRC="$1"; REF="$2"; OUT="$3"; shift 3
rm -rf "$OUT"; mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
git -C "$OUT" init -q; git -C "$OUT" add -A
git -C "$OUT" -c user.email=bench@local -c user.name=bench commit -q -m baseline

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
process.stderr.write(`applied ${ids.split(',').length} mutations into ${rel}\n`);
NODE
done

git -C "$OUT" diff --quiet && { echo "EMPTY diff" >&2; exit 3; }
echo "$OUT"
