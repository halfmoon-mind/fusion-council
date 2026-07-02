#!/usr/bin/env bash
# apply-mutant.sh <src_repo> <ref> <mutations_json> <mut_id> <out_dir>
# Build a LEAK-FREE repo whose baseline (single 'baseline' commit) is <src_repo>@<ref>'s tree (correct
# code), then apply the single find->replace synthetic mutation with id=<mut_id> to its target file, left
# UNCOMMITTED. Prints <out_dir>. mutations_json = { filePath (absolute), mutations:[{id,find,replace,...}] }.
# Use the SAME src@ref the mutations were proposed against (else the `find` snippets won't match the tree).
# `git archive` is read-only (committed tree only) so pointing at the live repo can't touch its working tree.
# A modification diff (reviewer sees before/after), but the mutation is a subtle single edit, so detection
# still requires understanding the logic; and the comparison across variants is on the identical diff.
set -euo pipefail
SRC="$1"; REF="$2"; MJSON="$3"; MID="$4"; OUT="$5"

rm -rf "$OUT"; mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
git -C "$OUT" init -q
git -C "$OUT" add -A
git -C "$OUT" -c user.email=bench@local -c user.name=bench commit -q -m baseline

node - "$MJSON" "$MID" "$OUT" <<'NODE'
const fs = require('fs');
const [ , , mjson, mid, out ] = process.argv;
const data = JSON.parse(fs.readFileSync(mjson, 'utf8'));
const rel = data.filePath.replace(/^.*\/((apps|packages|tools)\/.*)$/, '$1'); // repo-relative target
const m = (data.mutations || []).find(x => x.id === mid);
if (!m) { console.error('no mutation id ' + mid); process.exit(1); }
const fp = out + '/' + rel;
let src = fs.readFileSync(fp, 'utf8');
const n = src.split(m.find).length - 1;
if (n !== 1) { console.error(`find occurs ${n} times (need exactly 1) for ${mid}`); process.exit(2); }
fs.writeFileSync(fp, src.replace(m.find, m.replace));
process.stderr.write(`applied ${mid} -> ${rel}\n`);
NODE

git -C "$OUT" diff --quiet && { echo "EMPTY diff (mutation had no effect)" >&2; exit 3; }
nf=$(git -C "$OUT" diff --name-only | wc -l | tr -d ' ')
[ "$nf" = "1" ] || { echo "diff touches $nf files (want 1)" >&2; exit 4; }
echo "$OUT"
