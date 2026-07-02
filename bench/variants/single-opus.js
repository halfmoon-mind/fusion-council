export const meta = {
  name: 'bench-single-opus',
  description: 'Benchmark H1 baseline: a single Opus reviewer over the working-tree diff (no panel/judge/synth).',
  phases: [{ title: 'Capture' }, { title: 'Review' }],
}

// Verbatim copy of REVIEW_FRAMING from workflows/fusion-review.js (kept in sync by a bench drift-check:
// `grep -F` this string in the shipped file). Copying (not importing) because workflow scripts execute
// their whole body on import, so we cannot import a bare constant from fusion-review.js.
const REVIEW_FRAMING =
  'Review the following working-tree diff. Be terse and actionable; ground every finding in a file/line ' +
  'or a concrete behavior. Do not suggest unrelated cleanup. For every concrete code claim, cite the ' +
  'path:line it concerns; if you cannot, prefix that finding with [UNVERIFIED].'

// Same capture command shape as the shipped workflow (cwd = the case repo), minus the temp-file/marker
// machinery the single-agent baseline doesn't need — it just embeds the diff in its own prompt.
phase('Capture')
const diff = await agent(
  `Run EXACTLY this one read-only Bash command and return its output verbatim, no code fences:\n` +
    `  git diff --quiet; rc=$?; if [ "$rc" = 0 ]; then echo NO_DIFF; elif [ "$rc" = 1 ]; then ` +
    `git status --short; echo '---DIFF---'; git diff; else echo CAPTURE_FAILED; fi`,
  { model: 'haiku', phase: 'Capture', label: 'capture' }
)
const raw = diff ? String(diff).trim() : ''
if (/^\s*NO_DIFF\s*$/m.test(raw) || /CAPTURE_FAILED/.test(raw)) {
  return { review: 'No reviewable diff.', coverage: 'single-opus baseline; no diff', panel: [] }
}

// One strong model reviews the whole diff — the "single strong model" H1 baseline.
phase('Review')
const review = await agent(
  `You are a single expert code reviewer. ${REVIEW_FRAMING}\n\n` +
    `Output EXACTLY this structure:\n# Review\n## Findings  (each: Severity / File / Issue / Suggested fix)\n` +
    `## Test Gaps\nIf there are no actionable issues, say so clearly.\n\nDIFF:\n${raw}`,
  { model: 'opus', phase: 'Review', label: 'single-opus' }
)
return { review, judge: null, coverage: 'single-opus (baseline)', panel: ['single-opus'] }
