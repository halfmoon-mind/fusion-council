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
// 'high' = near-xhigh quality but ~1.6x faster on long tasks (measured A/B); pass codexEffort:'xhigh' for the hardest.
const codexEffort = (args && args.codexEffort) || 'high'

const READ_ONLY =
  'You are in read-only deliberation mode. You MAY read files, but you MUST NOT create, modify, or ' +
  'delete any file, and MUST NOT run state-changing commands. Produce only your analysis.\n\n'

// Shared diff-review framing: used verbatim for the Claude role seats (panelPrompt) AND inside the GPT
// seat's heredoc, so both model families get the SAME framing and it can't drift. (The GPT seat appends an
// explicit dimension list because, unlike the role seats, codex has no role .md telling it what to cover.)
const REVIEW_FRAMING =
  'Review the following working-tree diff. Be terse and actionable; ground every finding in a file/line ' +
  'or a concrete behavior. Do not suggest unrelated cleanup. For every concrete code claim, cite the ' +
  'path:line it concerns; if you cannot, prefix that finding with [UNVERIFIED].'

// ONE GPT seat (not N "role-lens" seats) with a two-section prompt (correctness + tests/scope): multiple
// GPT seats add zero model-family diversity and would let two GPT answers agreeing read as "cross-model
// consensus" to the family-blind judge, shielding a shared GPT error from the single-source merit drop.
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
// file via `>>`, so no LLM transcription can corrupt it. The full prompt file is fed to codex on STDIN
// (`- <"$F"`), NOT expanded into argv, so even a very large diff can't hit the ~1MB ARG_MAX launch ceiling
// the old "$(cat "$F")" path had. (Only the GPT seat reads the captured file: the 3 Claude role seats still
// embed `d`, haiku's copy of the SAME snapshot — so this stdin/ARG_MAX fix is the GPT seat only.) All seats
// derive from the ONE capture, so there is no Capture-vs-Panel timing divergence and the GPT seat needs no
// git/cwd of its own (verified: a temp file written by one subagent is readable by another, and an
// end-to-end run reports "GPT-5.5: ran"). The `<"$F"` redirect also closes stdin at EOF, so codex can't hang
// waiting for input ("Reading additional input from stdin...") on a backgrounded long xhigh run — the
// property the old explicit </dev/null gave, now supplied by feeding the prompt file itself.
// Failure sentinel (idiomatic here, cf. NO_DIFF): the seat returns this when codex didn't really run — or
// when the captured diff file is missing/empty — so the filter below drops it and coverage honestly says
// UNAVAILABLE instead of faking a "ran".
const CODEX_FAIL = 'CODEX_UNAVAILABLE'
const codexRun = (diffPath) => () =>
  agent(
    `You drive the local Codex CLI to get GPT-5.5's review of a working-tree diff. Do TWO steps in order; ` +
      `do NOT skip step 1.\n` +
      `STEP 1 — run this command verbatim BEFORE writing anything. It is read-only; the diff is ALREADY on ` +
      `disk so do NOT type it yourself (the shell reads it with cat). The heredoc body is the only fixed ` +
      `text; everything else is literal shell:\n` +
      `  [ -s '${diffPath}' ] || { echo ${CODEX_FAIL}; exit 0; }\n` +
      `  F=$(mktemp); cat > "$F" <<'FUSION_REVIEW_EOF'\n` +
      `${REVIEW_FRAMING} Report in TWO sections: (A) CORRECTNESS — regression risks, hidden coupling, ` +
      `overengineering; (B) TESTS & SCOPE — missing tests and out-of-scope changes.\n\n` +
      `DIFF:\n` +
      `FUSION_REVIEW_EOF\n` +
      `  cat '${diffPath}' >> "$F"\n` +
      `  OUT=$(mktemp); codex exec -s read-only --skip-git-repo-check -m ${codexModel} ` +
      `-c model_reasoning_effort="${codexEffort}" -o "$OUT" - <"$F"; cat "$OUT"; rm -f "$OUT" "$F" '${diffPath}'\n` +
      `STEP 2 — return ONLY Codex's final answer from step 1's ACTUAL stdout, verbatim, no preamble of your ` +
      `own. Reply with EXACTLY the single token ${CODEX_FAIL} (and nothing else) ONLY IF the command you ran ` +
      `produced no real answer — it errored, timed out, returned nothing, or printed only its banner / ` +
      `"Reading additional input from stdin...". Do NOT reply ${CODEX_FAIL} without running step 1.`,
    // sonnet, not the inherited Opus: this seat only shells out to codex and returns its output
    // verbatim — GPT-5.5 does the reasoning. Same tier as the capture:diff Bash-runner above.
    { model: 'sonnet', phase: 'Panel', label: `panel:gpt-${codexModel}` }
  )

// The sonnet wrapper sometimes returns the CODEX_FAIL sentinel WITHOUT actually running codex (observed
// ~1.6s, no Bash call); the prompt mandate above reduces but doesn't eliminate it. Retry the seat ONCE on a
// sentinel — a genuine codex outage stays CODEX_FAIL on the retry too (and is honestly dropped), but a
// spurious bail usually runs the second time. Each thunk call is a fresh subagent; only the failure path
// pays the extra attempt.
const withCodexRetry = (thunk) => async () => {
  const first = await thunk()
  if (first && String(first).trim() !== CODEX_FAIL) return first
  // `log` is a host-injected workflow global; guard with typeof so a runtime that lacks it can't throw a
  // ReferenceError on this exact failure path and defeat the retry. (typeof on an undeclared name is safe.)
  if (typeof log === 'function') log('fusion-review: GPT-5.5 seat returned CODEX_UNAVAILABLE — retrying once')
  return thunk()
}

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
  { label: `gpt-${codexModel}`, run: withCodexRetry(codexRun(diffPath)) },
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
    `diff — format "panelist: finding — why").\n\n` +
    `GROUNDING: for every finding that cites a path:line or describes specific code, confirm it against the ` +
    `diff above; use your read-only tools to open the cited file ONLY if it is not in the diff. Ground on ` +
    `whether the citation EXISTS and CONCERNS that code — tolerate paraphrase, do NOT require a verbatim ` +
    `quote. Put in invalidClaims (format "panelist: finding — ungroundable") any CONCRETE code claim you ` +
    `cannot tie to real code, and be willing to drop a weakly-grounded SINGLE-SOURCE finding this way; ` +
    `NEVER drop a consensus/cross-model finding for being single-raised. Prefer the embedded diff as ground ` +
    `truth; treat any on-disk file read as supplementary (the working tree may differ from the diff ` +
    `snapshot). A finding about a line OUTSIDE the diff hunk is VALID only if it bears on behavior the diff ` +
    `CHANGES — an unrelated pre-existing issue is out-of-scope, so exclude it. Default-to-invalidClaims on ` +
    `uncertainty applies ONLY to concrete code claims — never to judgment calls or recommendations.`,
  { schema: JUDGE_SCHEMA, model: 'opus', phase: 'Judge', label: 'judge' }
)

// 3) Synthesize — one findings report. Keep real issues, drop invalidClaims.
phase('Synthesize')
const review = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nReviewer findings (JSON):\n${JSON.stringify(answers)}\n\n` +
    `Judge (JSON):\n${JSON.stringify(judge)}\n\nCouncil coverage: ${coverage}\n\n` +
    `Write ONE review report. Keep consensus, preserve every uniqueInsight that survived invalidClaims (do ` +
    `NOT drop a finding merely for being single-source, and do NOT re-litigate the judge's merit calls; you ` +
    `MAY silently drop only an item that directly contradicts the diff or would break the output contract), ` +
    `route coverageGaps/blindSpots — plus any unstated assumptions or unspecified requirements the diff ` +
    `leaves open — into the "## Open Questions" section as QUESTIONS (that section ASKS; it must not assert ` +
    `a finding you cannot ground, so it never adds false positives), and silently EXCLUDE everything in ` +
    `invalidClaims (do NOT add a dropped-claims section; keep the exact output structure below). Only ` +
    `actionable findings. Do not edit files.\n\n` +
    `Output EXACTLY this structure:\n` +
    '# Fusion Review\n## Findings  (each: Severity / File / Issue / Suggested fix / Raised by)\n' +
    '## Cross-Model Agreement  (findings multiple families independently flagged)\n' +
    '## Test Gaps\n## Scope Check  (stayed within request? unrelated changes?)\n' +
    '## Recommended Next Action\n' +
    '## Open Questions  (unstated assumptions / unspecified requirements / dimensions not covered — tie ' +
    'each to a path:line where possible; phrase as questions, assert nothing ungrounded; omit the section ' +
    'only if genuinely none)\n' +
    `## Council Coverage  (${coverage})\n\n` +
    `If there are no actionable issues, say so clearly and list any residual test risk.`,
  { model: 'opus', phase: 'Synthesize', label: 'synthesize' }
)

return { review, judge, coverage, panel: ran }
