export const meta = {
  name: 'fusion-review',
  description:
    'Deterministic read-only review council: Claude role panel (skeptic/test/maintainer) + GPT-5.5 review the working-tree diff, judged and synthesized into one findings report. Returns early if there is no diff.',
  whenToUse:
    'After implementing a non-trivial change, to vet the diff from multiple model families before merge. Takes no args — it reviews the current `git diff`.',
  phases: [{ title: 'Capture' }, { title: 'Panel' }, { title: 'Judge' }, { title: 'Synthesize' }],
}

// Plugin-shipped subagents are namespaced <plugin>:<agent>. Bare names won't resolve once installed.
const NS = 'fusion-council:'

const codexModel = (args && args.codexModel) || 'gpt-5.5'
const codexEffort = (args && args.codexEffort) || 'xhigh'

const READ_ONLY =
  'You are in read-only deliberation mode. You MAY read files, but you MUST NOT create, modify, or ' +
  'delete any file, and MUST NOT run state-changing commands. Produce only your analysis.\n\n'

// Same merit schema as fusion-plan: invalidClaims lets synthesis drop any panelist's weak finding.
const JUDGE_SCHEMA = {
  type: 'object',
  required: ['consensus', 'contradictions', 'uniqueInsights', 'coverageGaps', 'blindSpots', 'invalidClaims'],
  additionalProperties: false,
  properties: {
    consensus: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
    uniqueInsights: { type: 'array', items: { type: 'string' } }, // prefix each with the panelist name
    coverageGaps: { type: 'array', items: { type: 'string' } },
    blindSpots: { type: 'array', items: { type: 'string' } },
    invalidClaims: { type: 'array', items: { type: 'string' } }, // "panelist: claim — why it's wrong"
  },
}

// </dev/null is REQUIRED: codex exec waits for stdin EOF ("Reading additional input from stdin...")
// even with a prompt arg, so an open-pipe stdin (e.g. when a long xhigh run gets backgrounded) hangs
// it forever and -o "$OUT" is never written. Closing stdin makes the seat deterministic.
const codexRun = (prompt) => () =>
  agent(
    `Use the local Codex CLI to review the diff below as an independent senior engineer, then return ` +
      `ONLY Codex's final answer verbatim — no preamble of your own.\n` +
      `Run it non-interactively and read-only. Use exactly:\n` +
      `  OUT=$(mktemp); codex exec -s read-only --skip-git-repo-check -m ${codexModel} ` +
      `-c model_reasoning_effort="${codexEffort}" -o "$OUT" "<the prompt>" </dev/null; cat "$OUT"; rm -f "$OUT"\n\n` +
      `Pass this as the prompt, and have Codex report: correctness/regression risks, hidden coupling, ` +
      `overengineering, missing tests, and anything outside the change's scope.\n\n${prompt}`,
    { phase: 'Panel', label: `panel:gpt-${codexModel}` }
  )

// 0) Capture the diff — it IS the subject. Role panelists are read-only with no Bash, so the diff must
//    be embedded in their prompt. No diff is a terminal data condition (not a judgment gate): return.
phase('Capture')
const diff = await agent(
  `Run these read-only Bash commands and return their combined output verbatim — nothing else:\n` +
    `  git status --short; echo '---DIFF---'; git diff\n` +
    `If 'git diff' produces no output, return exactly NO_DIFF.`,
  { model: 'haiku', phase: 'Capture', label: 'capture:diff' }
)
const d = diff && String(diff).trim()
if (!d || d === 'NO_DIFF') {
  return { review: 'No working-tree diff to review.', coverage: 'skipped — no diff', panel: [] }
}

const panelPrompt =
  `Review the following working-tree diff. Be terse and actionable; ground every finding in a file/line ` +
  `or a concrete behavior. Do not suggest unrelated cleanup.\n\nDIFF:\n${d}`

// 1) Panel — 3 Claude reviewer roles (architect is for planning, not review) + GPT-5.5. All parallel.
phase('Panel')
const ROLES = ['fusion-skeptic', 'fusion-test-strategist', 'fusion-maintainer']
const PANEL = [
  ...ROLES.map((r) => ({
    label: r,
    run: () => agent(READ_ONLY + panelPrompt, { agentType: NS + r, phase: 'Panel', label: `panel:${r}` }),
  })),
  { label: `gpt-${codexModel}`, run: codexRun(panelPrompt) },
]

const answers = (
  await parallel(PANEL.map((m) => () => m.run().then((a) => ({ panelist: m.label, analysis: a }))))
)
  .filter(Boolean)
  .filter((r) => r.analysis && String(r.analysis).trim())

if (!answers.length) throw new Error('fusion-review: no panelist produced output')

const ran = answers.map((a) => a.panelist)
const gptRan = ran.some((l) => l.startsWith('gpt-'))
const coverage = `Seats: ${ran.join(', ')}. GPT-5.5: ${
  gptRan ? 'ran' : 'UNAVAILABLE — Claude-only this run, model diversity reduced'
}.`

// 2) Judge — merit comparison across reviewers.
phase('Judge')
const judge = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nReviewer findings (JSON):\n${JSON.stringify(answers, null, 2)}\n\n` +
    `Compare on merit — no panelist is privileged. Extract: consensus; contradictions; uniqueInsights ` +
    `(real issues only ONE caught — prefix with the panelist); coverageGaps; blindSpots; and ` +
    `invalidClaims (any finding, INCLUDING GPT's, that is wrong, out of scope, or unsupported by the ` +
    `diff — format "panelist: finding — why").`,
  { schema: JUDGE_SCHEMA, model: 'opus', phase: 'Judge', label: 'judge' }
)

// 3) Synthesize — one findings report. Keep real issues, drop invalidClaims.
phase('Synthesize')
const review = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nReviewer findings (JSON):\n${JSON.stringify(answers)}\n\n` +
    `Judge (JSON):\n${JSON.stringify(judge)}\n\nCouncil coverage: ${coverage}\n\n` +
    `Write ONE review report. Keep consensus, preserve every uniqueInsight, surface blindSpots/` +
    `coverageGaps, and EXCLUDE everything in invalidClaims. Only actionable findings. Do not edit files.\n\n` +
    `Output EXACTLY this structure:\n` +
    '# Fusion Review\n## Findings  (each: Severity / File / Issue / Suggested fix / Raised by)\n' +
    '## Cross-Model Agreement  (findings multiple families independently flagged)\n' +
    '## Test Gaps\n## Scope Check  (stayed within request? unrelated changes?)\n' +
    `## Recommended Next Action\n## Council Coverage  (${coverage})\n\n` +
    `If there are no actionable issues, say so clearly and list any residual test risk.`,
  { model: 'opus', phase: 'Synthesize', label: 'synthesize' }
)

return { review, judge, coverage, panel: ran }
