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

// Shared diff-review framing: used verbatim for the Claude role seats (panelPrompt) AND inside the GPT
// seat's heredoc, so both model families get the SAME framing and it can't drift. (The GPT seat appends an
// explicit dimension list because, unlike the role seats, codex has no role .md telling it what to cover.)
const REVIEW_FRAMING =
  'Review the following working-tree diff. Be terse and actionable; ground every finding in a file/line ' +
  'or a concrete behavior. Do not suggest unrelated cleanup.'

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

// A2 (option b): the capture seat writes its diff snapshot to a temp file and returns the path; the GPT
// seat `cat`s THAT file into codex's prompt, so the diff reaches codex's prompt WITHOUT being retyped by
// an LLM. The old path made the sonnet wrapper retype the whole diff into a heredoc body — large diffs got
// truncated/reordered while coverage still said "ran". Now only the small fixed review instruction goes
// through the QUOTED heredoc (which the wrapper copies reliably); the diff is appended from the captured
// file via `>>`, so no LLM transcription can corrupt it. (It is STILL expanded into codex's argv via
// "$(cat "$F")", so a very large diff can still hit the ~1MB ARG_MAX and fail to launch — that limit is
// unchanged from the old path. And only the GPT seat reads the file: the 3 Claude role seats still embed
// `d`, haiku's copy of the SAME snapshot — so this fix is the GPT seat only.) All seats derive from the
// ONE capture, so there is no Capture-vs-Panel timing divergence and the GPT seat needs no git/cwd of its
// own (verified: a temp file written by one subagent is readable by another, and an end-to-end run reports
// "GPT-5.5: ran"). </dev/null is STILL REQUIRED: codex exec waits for stdin EOF ("Reading additional input
// from stdin...") even with a prompt arg, so an open-pipe stdin (e.g. a backgrounded long xhigh run) hangs
// it forever and -o "$OUT" is never written.
// Failure sentinel (idiomatic here, cf. NO_DIFF): the seat returns this when codex didn't really run — or
// when the captured diff file is missing/empty — so the filter below drops it and coverage honestly says
// UNAVAILABLE instead of faking a "ran".
const CODEX_FAIL = 'CODEX_UNAVAILABLE'
const codexRun = (diffPath) => () =>
  agent(
    `Use the local Codex CLI to review the working-tree diff (already saved on disk) as an independent ` +
      `senior engineer, then return ONLY Codex's final answer verbatim — no preamble of your own.\n` +
      `You MUST actually run the Bash command below and base your reply ONLY on its real output. NEVER ` +
      `reply ${CODEX_FAIL} without having run the command — emit that single token (and nothing else) ONLY ` +
      `when the command you ran genuinely fails, errors, times out, returns nothing, or prints only its ` +
      `banner / "Reading additional input from stdin...".\n` +
      `Run it non-interactively and read-only. Do NOT type the diff yourself — it is ALREADY on disk; the ` +
      `shell reads it with cat. Run EXACTLY this; the heredoc body is the only fixed text, everything else ` +
      `is literal shell:\n` +
      `  [ -s '${diffPath}' ] || { echo ${CODEX_FAIL}; exit 0; }\n` +
      `  F=$(mktemp); cat > "$F" <<'FUSION_REVIEW_EOF'\n` +
      `${REVIEW_FRAMING} Report across every dimension the role seats cover: correctness/regression ` +
      `risks, hidden coupling, overengineering, missing tests, and anything outside the change's scope.\n\n` +
      `DIFF:\n` +
      `FUSION_REVIEW_EOF\n` +
      `  cat '${diffPath}' >> "$F"\n` +
      `  OUT=$(mktemp); codex exec -s read-only --skip-git-repo-check -m ${codexModel} ` +
      `-c model_reasoning_effort="${codexEffort}" -o "$OUT" "$(cat "$F")" </dev/null; cat "$OUT"; rm -f "$OUT" "$F" '${diffPath}'`,
    // sonnet, not the inherited Opus: this seat only shells out to codex and returns its output
    // verbatim — GPT-5.5 does the reasoning. Same tier as the capture:diff Bash-runner above.
    { model: 'sonnet', phase: 'Panel', label: `panel:gpt-${codexModel}` }
  )

// 0) Capture the diff — it IS the subject. Role panelists are read-only with no Bash, so the diff must
//    be embedded in their prompt. No diff is a terminal data condition (not a judgment gate): return.
phase('Capture')
const diff = await agent(
  `Run EXACTLY this one read-only Bash command and return its output verbatim — nothing else, and do ` +
    `NOT wrap it in code fences:\n` +
    `  git diff --quiet; rc=$?; if [ "$rc" = 0 ]; then echo NO_DIFF; elif [ "$rc" = 1 ]; then F=$(mktemp); ` +
    `{ git status --short; echo '---DIFF---'; git diff; } > "$F"; printf '===FUSION_DIFF_PATH===%s\\n' "$F"; cat "$F"; ` +
    `else echo CAPTURE_FAILED; fi`,
  { model: 'haiku', phase: 'Capture', label: 'capture:diff' }
)
// The capture seat saved the snapshot to a temp file and printed a ===FUSION_DIFF_PATH=== marker line
// FIRST, then the diff. Marker-first is deliberate: if the haiku seat truncates its RETURN on a very large
// diff, the path still survives at the top, so the GPT seat can still cat the FULL diff from the file (only
// the role seats' embedded `d` would be short). The marker's presence is the "diff exists" signal.
const raw = diff ? String(diff).trim() : ''
// Capture emits exactly one of: `NO_DIFF` (rc 0), `===FUSION_DIFF_PATH===<path>\n<diff>` (rc 1), or
// `CAPTURE_FAILED` (git errored, rc>1 — so a git error can't masquerade as a reviewable diff). Match the
// marker ANCHORED to start-of-line so a diff body that contains the literal string (e.g. reviewing THIS
// file) can't false-match — only capture's printf emits it at column 0 — and capture the path to EOL so a
// TMPDIR with spaces survives. The marker is the FIRST line, so the first anchored match is the real one.
// (mktemp yields an alphanumeric path, so the single-quoted '${diffPath}' in the GPT seat is safe; a quote
// in TMPDIR is not handled.)
const pm = raw.match(/^===FUSION_DIFF_PATH===(.+)$/m)
if (!pm) {
  // No marker: ONLY a line that is exactly NO_DIFF is "nothing to review" (line-anchored, not a loose
  // substring, and tolerant of fences/whitespace the haiku seat may add). CAPTURE_FAILED or any other
  // output means capture FAILED — fail loudly rather than silently skip a dirty tree.
  if (/^\s*NO_DIFF\s*$/m.test(raw)) {
    return { review: 'No working-tree diff to review.', coverage: 'skipped — no diff', panel: [] }
  }
  throw new Error('fusion-review: capture produced neither a diff-path marker nor NO_DIFF (capture unavailable)')
}
const diffPath = pm[1].trim()
const d = raw.slice(pm.index + pm[0].length).trim() // diff follows the marker line now

const panelPrompt = `${REVIEW_FRAMING}\n\nDIFF:\n${d}`

// 1) Panel — 3 Claude reviewer roles (architect is for planning, not review) + GPT-5.5. All parallel.
phase('Panel')
const ROLES = ['fusion-skeptic', 'fusion-test-strategist', 'fusion-maintainer']
const PANEL = [
  ...ROLES.map((r) => ({
    label: r,
    run: () => agent(READ_ONLY + panelPrompt, { agentType: NS + r, phase: 'Panel', label: `panel:${r}` }),
  })),
  { label: `gpt-${codexModel}`, run: codexRun(diffPath) },
]

const answers = (
  await parallel(PANEL.map((m) => () => m.run().then((a) => ({ panelist: m.label, analysis: a }))))
)
  .filter(Boolean)
  .filter((r) => r.analysis && String(r.analysis).trim())
  .filter((r) => String(r.analysis).trim() !== CODEX_FAIL) // codex didn't really run → drop, don't fake it

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
