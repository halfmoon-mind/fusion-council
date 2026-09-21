export const meta = {
  name: 'fusion-review',
  description:
    'Deterministic read-only review council: one generalist Claude seat + GPT-5.6 Sol review the working-tree diff, then one merged judge+synthesize call grounds the findings and writes one report (duo default; args.roles restores the Claude role panel, args.splitSynth the two-call judge→synthesize pipeline). Returns early if there is no diff. Run stats (arm, seats, claim counts) travel in the returned `stats`, so the workflow journal is the telemetry.',
  whenToUse:
    'After implementing a non-trivial change, to vet the diff from multiple model families before merge. It reviews the current `git diff`; no args required — optional: roles:true restores the Claude role panel, noGpt drops the GPT seat, splitSynth:true the two-call judge→synthesize pipeline.',
  phases: [{ title: 'Capture' }, { title: 'Panel' }, { title: 'Judge' }, { title: 'Synthesize' }],
}

// Plugin-shipped subagents are namespaced <plugin>:<agent>. Bare names won't resolve once installed.
const NS = 'fusion-council:'

// Headless orchestrators sometimes pass args as a JSON-ENCODED STRING (observed: bench arm silently
// degraded to full because "{\"noGpt\": true}".noGpt is undefined). Normalize ONCE before any flag read.
let A = args
if (typeof A === 'string' && A.trim().startsWith('{')) {
  try { A = JSON.parse(A) } catch (e) { /* not JSON — leave as-is */ }
}
const codexModel = (A && A.codexModel) || 'gpt-5.6-sol'
// 'high' = near-xhigh quality but ~1.6x faster on long tasks (A/B measured on gpt-5.5, not re-run on 5.6); pass codexEffort:'xhigh' for the hardest.
const codexEffort = (A && A.codexEffort) || 'high'
// DEFAULT = DUO: one generalist Claude seat + GPT + the same judge/synthesize — the two mechanisms the
// verified evidence supports (cross-family seat + grounded judge). Bench-measured post-v0.1.13 (EVAL.md
// §B5′ re-validation): duo ties the role panel on recall (incl. the one hard case) and beats it on the
// primary metrics — clean-diff FP floor ~2.0 vs 3.5/run and cost −21% — so the role panel is opt-in now.
// args.roles restores it (fusion-plan still runs its role panel; agents/*.md serve both). args.duo is
// legacy (it IS the default) and accepted as a no-op. noGpt = drop the GPT seat (the GPT-marginal arm;
// with roles it reproduces the historical 'nogpt' bench arm). Reversion criteria live in EVAL.md.
const noGpt = !!(A && A.noGpt)
const roles = !!(A && A.roles)
const duo = !roles
// DEFAULT = MERGED (since 0.3.0): judge + synthesize collapsed into ONE opus call that returns the
// judge fields AND the final report together. Synthesize did no independent verification (it may not
// re-litigate merit calls), and both measured post-judge information losses — the correctedFindings
// sink and the assertion-demotion — were judge→synthesize HANDOFF bugs; one call removes the seam and
// saves the pipeline's second-largest input pass. Bench 2026-08-05 (EVAL.md §B0, same-era duo pairs):
// recall tie (5/5 bug cases incl. the hard one), clean-case noise lower on all three cleans, cost −7% —
// the feared same-call invalidClaims softening did not appear. args.splitSynth restores the two-call
// pipeline (the historical full/nogpt/duo bench arms send it); args.mergedSynth is legacy (it IS the
// default), accepted as a no-op. Pre-registered reversion criteria live in EVAL.md §B0.
const mergedSynth = !(A && A.splitSynth)

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
  required: ['consensus', 'contradictions', 'uniqueInsights', 'coverageGaps', 'blindSpots', 'invalidClaims', 'correctedFindings'],
  additionalProperties: false,
  properties: {
    consensus: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
    uniqueInsights: { type: 'array', items: { type: 'string' } }, // prefix each with the panelist name
    coverageGaps: { type: 'array', items: { type: 'string' } },
    blindSpots: { type: 'array', items: { type: 'string' } },
    invalidClaims: { type: 'array', items: { type: 'string' } }, // "panelist: claim — why it's wrong"
    // Judge-authored positive findings implied by refuting an EXCULPATORY claim. Synthesize excludes
    // invalidClaims wholesale, so without this field the judge's own bug-knowledge inside a refutation
    // is an information sink (measured: bench 2026-07-14, a real seeded bug lost exactly this way).
    correctedFindings: { type: 'array', items: { type: 'string' } },
  },
}

// mergedSynth: identical judge fields + the report from the same call — telemetry keeps the exact judge
// shape, and a finding can't be lost in a handoff the arm no longer makes.
const MERGED_SCHEMA = {
  ...JUDGE_SCHEMA,
  required: [...JUDGE_SCHEMA.required, 'report'],
  properties: { ...JUDGE_SCHEMA.properties, report: { type: 'string' } },
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
// end-to-end run reports "GPT-5.6 Sol: ran"). The `<"$F"` redirect also closes stdin at EOF, so codex can't hang
// waiting for input ("Reading additional input from stdin...") on a backgrounded long xhigh run — the
// property the old explicit </dev/null gave, now supplied by feeding the prompt file itself.
// Failure sentinel (idiomatic here, cf. NO_DIFF): the seat returns this when codex didn't really run — or
// when the captured diff file is missing/empty — so the filter below drops it and coverage honestly says
// UNAVAILABLE instead of faking a "ran".
const CODEX_FAIL = 'CODEX_UNAVAILABLE'
const codexRun = (diffPath) => () =>
  agent(
    `You drive the local Codex CLI to get GPT-5.6 Sol's review of a working-tree diff. Do TWO steps in order; ` +
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
    // verbatim — GPT-5.6 Sol does the reasoning. Same tier as the capture:diff Bash-runner above.
    { model: 'sonnet', phase: 'Panel', label: `panel:gpt-${codexModel}` }
  )

// The sonnet wrapper sometimes returns the CODEX_FAIL sentinel WITHOUT actually running codex (observed
// ~1.6s, no Bash call); the prompt mandate above reduces but doesn't eliminate it. Retry the seat ONCE on a
// sentinel — a genuine codex outage stays CODEX_FAIL on the retry too (and is honestly dropped), but a
// spurious bail usually runs the second time. Each thunk call is a fresh subagent; only the failure path
// pays the extra attempt.
// telemetry: the FIRST GPT attempt returned the sentinel, i.e. a retry was ATTEMPTED — the retry may
// still have failed, so gpt_retried:true can co-occur with gpt_ran:false. Not "retry succeeded".
let gptRetried = false
const withCodexRetry = (thunk) => async () => {
  const first = await thunk()
  if (first && String(first).trim() !== CODEX_FAIL) return first
  gptRetried = true
  // `log` is a host-injected workflow global; guard with typeof so a runtime that lacks it can't throw a
  // ReferenceError on this exact failure path and defeat the retry. (typeof on an undeclared name is safe.)
  if (typeof log === 'function') log('fusion-review: GPT-5.6 Sol seat returned CODEX_UNAVAILABLE — retrying once')
  return thunk()
}

// 0) Capture the diff — it IS the subject. Role panelists are read-only with no Bash, so the diff must
//    be embedded in their prompt. No diff is a terminal data condition (not a judgment gate): return.
phase('Capture')
const captureOnce = () =>
  agent(
    `Run EXACTLY this one read-only Bash command and return its complete stdout verbatim. Your ENTIRE reply ` +
      `must be a byte-for-byte copy of that stdout, beginning with its VERY FIRST line — which will be either ` +
      `NO_DIFF, CAPTURE_FAILED, or a line starting with ===FUSION_DIFF_PATH=== (this marker line is REQUIRED ` +
      `and must be the first line of your reply; never omit, summarize, or replace it). No commentary, no ` +
      `code fences, no phrases like "output captured above":\n` +
      `  git diff --quiet; rc=$?; if [ "$rc" = 0 ]; then echo NO_DIFF; elif [ "$rc" = 1 ]; then F=$(mktemp); ` +
      `{ git status --short; echo '---DIFF---'; git diff; } > "$F"; printf '===FUSION_DIFF_PATH===%s\\n' "$F"; cat "$F"; ` +
      `else echo CAPTURE_FAILED; fi`,
    { model: 'haiku', phase: 'Capture', label: 'capture:diff' }
  )
// The capture seat saved the snapshot to a temp file and printed a ===FUSION_DIFF_PATH=== marker line
// FIRST, then the diff. Marker-first is deliberate: if the haiku seat truncates its RETURN on a very large
// diff, the path still survives at the top, so the GPT seat can still cat the FULL diff from the file (only
// the role seats' embedded `d` would be short). The marker's presence is the "diff exists" signal.
let raw = String((await captureOnce()) || '').trim()
// Capture emits exactly one of: `NO_DIFF` (rc 0), `===FUSION_DIFF_PATH===<path>\n<diff>` (rc 1), or
// `CAPTURE_FAILED` (git errored, rc>1 — so a git error can't masquerade as a reviewable diff). Match the
// marker ANCHORED to start-of-line so a diff body that contains the literal string (e.g. reviewing THIS
// file) can't false-match — only capture's printf emits it at column 0 — and capture the path to EOL so a
// TMPDIR with spaces survives. The marker is the FIRST line, so the first anchored match is the real one.
// (mktemp yields an alphanumeric path, so the single-quoted '${diffPath}' in the GPT seat is safe; a quote
// in TMPDIR is not handled.)
let pm = raw.match(/^===FUSION_DIFF_PATH===(.+)$/m)
// Relay-bail retry (cf. withCodexRetry — same disease, different seat): observed in real usage on a large
// diff — the seat RAN the command correctly but its reply was "output captured above" commentary plus a
// copy MISSING the marker line (and it happened on an opus-pinned seat, so a stronger model is not the
// fix). Capture is read-only and idempotent, so a marker-less reply gets ONE fresh attempt before the run
// fails loudly. NO_DIFF is a terminal answer, never retried; CAPTURE_FAILED shares the one retry — a
// genuine git error repeats and still lands on the throw below.
let captureRetried = false
if (!pm && !/^\s*NO_DIFF\s*$/m.test(raw)) {
  captureRetried = true
  if (typeof log === 'function') log('fusion-review: capture reply missing the diff-path marker — retrying once')
  raw = String((await captureOnce()) || '').trim()
  pm = raw.match(/^===FUSION_DIFF_PATH===(.+)$/m)
}
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

// 1) Panel — 3 Claude reviewer roles (architect is for planning, not review) + GPT-5.6 Sol. All parallel.
phase('Panel')
const ROLES = duo ? [] : ['fusion-skeptic', 'fusion-test-strategist', 'fusion-maintainer']
const PANEL = [
  ...ROLES.map((r) => ({
    label: r,
    run: () => agent(READ_ONLY + panelPrompt, { agentType: NS + r, phase: 'Panel', label: `panel:${r}` }),
  })),
  // duo (default): one generalist Claude seat, pinned to opus for arm stability, given the same
  // two-section dimension list the GPT seat gets (no role .md supplies coverage) so prompt strength
  // is equal across arms.
  ...(duo
    ? [
        {
          label: 'claude-generalist',
          run: () =>
            agent(
              READ_ONLY +
                panelPrompt +
                `\n\nReport in TWO sections: (A) CORRECTNESS — regression risks, hidden coupling, ` +
                `overengineering; (B) TESTS & SCOPE — missing tests and out-of-scope changes.`,
              { model: 'claude-opus-5', phase: 'Panel', label: 'panel:claude-generalist' }
            ),
        },
      ]
    : []),
  ...(noGpt ? [] : [{ label: `gpt-${codexModel}`, run: withCodexRetry(codexRun(diffPath)) }]),
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
const coverage = `Seats: ${ran.join(', ')}. GPT-5.6 Sol: ${
  gptRan ? 'ran' : 'UNAVAILABLE — Claude-only this run, model diversity reduced'
}.`

// 2) Judge — merit comparison across reviewers.
// CROSS-FAMILY rule: the 3 Claude role seats share one base model, so their mutual agreement is
// correlated sampling (same-vendor frontier models agree on ~60% of their joint errors — Kim et al.,
// ICML 2025), while GPT's unique findings are single-source BY CONSTRUCTION (it also only sees the
// diff, no repo access, so it is structurally the most "ungroundable" seat). Without this rule the
// single-source drop leniency systematically tilts against the council's only cross-family seat and
// gives a shared Opus misreading multi-source cover. Corroboration = both families, nothing less.
phase('Judge')
// Instruction text shared VERBATIM by the split pipeline and the mergedSynth arm, so the bench compares
// architecture (one call vs two), not prompt drift.
const JUDGE_TASK =
  `Compare on merit — no panelist is privileged. Extract: consensus (prefix findings BOTH model families ` +
  `independently raised with [cross-family]); contradictions; uniqueInsights ` +
  `(real issues only ONE caught — prefix with the panelist); coverageGaps; blindSpots; and ` +
  `invalidClaims (any finding, INCLUDING GPT's, that is wrong, out of scope, or unsupported by the ` +
  `diff — format "panelist: finding — why"); and correctedFindings (JUDGE-AUTHORED: whenever an ` +
  `invalidClaims entry refutes an EXCULPATORY claim — "this change is fine/safe/consistent" — assert the ` +
  `corrected concrete finding your refutation implies, format "file:line — issue — why", so that knowledge ` +
  `survives the invalidClaims exclusion; [] when no refutation implies one).\n\n` +
  `GROUNDING: for every finding that cites a path:line or describes specific code, confirm it against the ` +
  `diff above; use your read-only tools to open the cited file ONLY if it is not in the diff. Ground on ` +
  `whether the citation EXISTS and CONCERNS that code — tolerate paraphrase, do NOT require a verbatim ` +
  `quote. Put in invalidClaims (format "panelist: finding — ungroundable") any CONCRETE code claim you ` +
  `cannot tie to real code, and be willing to drop a weakly-grounded SINGLE-SOURCE finding this way; ` +
  `NEVER drop a finding BOTH model families raised without checking it against the diff first. ` +
  `CORROBORATION IS CROSS-FAMILY ONLY: the Claude role seats share one base model behind different ` +
  `lenses, so Claude-only agreement is correlated sampling, NOT independent confirmation — hold a ` +
  `Claude-majority finding to the SAME grounding bar as a single-source one, and never count Claude-seat ` +
  `agreement as evidence against the GPT seat's single-raised finding (GPT sees only the diff, so judge ` +
  `its findings against the diff, not against repo files it could not read). Prefer the embedded diff as ground ` +
  `truth; treat any on-disk file read as supplementary (the working tree may differ from the diff ` +
  `snapshot). A finding about a line OUTSIDE the diff hunk is VALID only if it bears on behavior the diff ` +
  `CHANGES — an unrelated pre-existing issue is out-of-scope, so exclude it. Default-to-invalidClaims on ` +
  `uncertainty applies ONLY to concrete code claims — never to judgment calls or recommendations.`
const REPORT_TASK =
  `Write ONE review report. Keep consensus, preserve every uniqueInsight that survived invalidClaims (do ` +
  `NOT drop a finding merely for being single-source, and do NOT re-litigate the judge's merit calls; you ` +
  `MAY silently drop only an item that directly contradicts the diff or would break the output contract), ` +
  `include every correctedFindings item under "## Findings" (Raised by: judge), ` +
  `route coverageGaps/blindSpots — plus any unstated assumptions or unspecified requirements the diff ` +
  `leaves open — into the "## Open Questions" section as QUESTIONS (that section ASKS; it must not assert ` +
  `a finding you cannot ground, so it never adds false positives). NEVER DEMOTE AN ASSERTION: a consensus/` +
  `uniqueInsights/correctedFindings item that asserts a CONCRETE defect (cites code and a mechanism) MUST ` +
  `appear under "## Findings" as an assertion — do not rephrase it into a question or file it under Test ` +
  `Gaps/Open Questions (measured failure mode: a real panel-raised bug demoted to Open Questions and lost). ` +
  `Open Questions is ONLY for genuinely interrogative items. Silently EXCLUDE everything in ` +
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
  `If there are no actionable issues, say so clearly and list any residual test risk.`

let judge, review
if (mergedSynth) {
  // One call adjudicates AND writes: the report is filled from the model's own judge fields, so the two
  // measured losses (correctedFindings sink, assertion demotion) can no longer happen AS HANDOFF bugs.
  // Intra-call omission remains possible — that residual is exactly what the bench arm measures.
  const merged = await agent(
    READ_ONLY +
      `${panelPrompt}\n\nReviewer findings (JSON):\n${JSON.stringify(answers, null, 2)}\n\n` +
      `Council coverage: ${coverage}\n\n` +
      `FIRST fill the judge fields. ${JUDGE_TASK}\n\n` +
      `THEN fill \`report\` in this SAME response, applying your own judge fields above exactly as a ` +
      `downstream synthesizer would: ${REPORT_TASK}`,
    { schema: MERGED_SCHEMA, model: 'claude-opus-5', phase: 'Judge', label: 'judge+synthesize' }
  )
  // Typed, not truthy: this runtime boundary already produced a string-where-object-expected bug once
  // (the JSON-string args normalization above), and a rest-spread over a raw string would ship character
  // indices to telemetry as the "judge" while review lands undefined.
  if (!merged || typeof merged.report !== 'string' || !merged.report.trim())
    throw new Error('fusion-review: merged judge+synthesize seat produced no usable report')
  const { report, ...rest } = merged
  judge = rest
  review = report
} else {
  judge = await agent(
    READ_ONLY +
      `${panelPrompt}\n\nReviewer findings (JSON):\n${JSON.stringify(answers, null, 2)}\n\n` +
      JUDGE_TASK,
    { schema: JUDGE_SCHEMA, model: 'claude-opus-5', phase: 'Judge', label: 'judge' }
  )

  // 3) Synthesize — one findings report. Keep real issues, drop invalidClaims.
  phase('Synthesize')
  review = await agent(
    READ_ONLY +
      `${panelPrompt}\n\nReviewer findings (JSON):\n${JSON.stringify(answers)}\n\n` +
      `Judge (JSON):\n${JSON.stringify(judge)}\n\nCouncil coverage: ${coverage}\n\n` +
      REPORT_TASK,
    { model: 'claude-opus-5', phase: 'Synthesize', label: 'synthesize' }
  )
}

// Run stats for eval/analyze.sh — they ride in the return value, which the harness writes to the workflow
// journal (~/.claude/projects/*/*/workflows/wf_*.json) together with per-seat model/tokens/duration and
// status. That journal replaced the sonnet telemetry seat (0.5.0): same data, no heredoc relay, no write.
// claims = bullet / numbered / bold-numbered (**A1.**) / ###-heading lines: the survival-per-claim
// denominator (Goodhart guard). The old bullet-only regex counted 0 for a generalist writing **A1.**.
const claims = (t) => String(t).split('\n').filter((l) => /^\s*([-*•]\s|\d+[.)]\s|\*\*[A-Z]?\d+[.)]?|#{3,6}\s)/.test(l)).length
const stats = {
  arm: (roles ? (noGpt ? 'nogpt' : 'full') : noGpt ? 'duo-nogpt' : 'duo') + (mergedSynth ? '-merged' : ''),
  gpt_ran: gptRan, gpt_retried: gptRetried, capture_retried: captureRetried, codexModel, codexEffort,
  seats: answers.map((a) => ({ panelist: a.panelist, chars: String(a.analysis).length, claims: claims(a.analysis) })),
  subject_head: String(d).slice(0, 200),
}
return { review, judge, coverage, panel: ran, stats }
