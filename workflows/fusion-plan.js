export const meta = {
  name: 'fusion-plan',
  description:
    'Deterministic read-only planning council: Claude role panel (architect/skeptic/test/maintainer) + GPT-5.5, judged and synthesized into one implementation plan. Every invocation runs the full pipeline — no skip gate. Appends run telemetry to ~/.fusion-council (disable: args.noTelemetry).',
  whenToUse:
    'Before a non-trivial change you choose to vet: architecture decisions, refactors, risky/multi-file edits, unclear bugs. Pass {task}. YOU decide when to run it; it always runs everything.',
  phases: [{ title: 'Context' }, { title: 'Panel' }, { title: 'Judge' }, { title: 'Synthesize' }],
}

// Plugin-shipped subagents are namespaced <plugin>:<agent>. Bare names won't resolve once installed.
const NS = 'fusion-council:'

// Accept Workflow({args:"task text"}) or Workflow({args:{task}}).
const task = typeof args === 'string' ? args : args?.task
if (!task || !String(task).trim()) {
  throw new Error('fusion-plan: missing args.task (pass the change you want planned)')
}

// GPT-5.5 = the ONLY non-Claude diversity axis, so it's a MANDATORY panel seat (always in PANEL below).
// ONE seat (not N "role-lens" seats) with a two-section prompt (recommend + risks): splitting GPT into
// multiple seats adds ZERO model-family diversity (same model), and two GPT answers agreeing would read as
// "cross-model consensus" to the family-blind judge — shielding a shared GPT error from the single-source
// merit drop. One honest single-source seat avoids that; depth comes from the two prompt sections instead.
// ChatGPT sub only runs gpt-5.5 / gpt-5.4; 'high' = near-xhigh quality but ~1.6x faster on long tasks
// (measured A/B, identical input), so it's the default; pass codexEffort:'xhigh' for the hardest, 'low' for raw speed.
const codexModel = (args && args.codexModel) || 'gpt-5.5'
const codexEffort = (args && args.codexEffort) || 'high'
const noContext = !!(args && args.noContext)
// Eval ablation arm (EVAL.md §C) — default OFF, real usage unaffected. duo = ONE generalist Claude seat
// + GPT + the same judge/synthesize: the literature-pointed comparator the full role panel must beat.
const duo = !!(args && args.duo)
// Disclosed side-effect gate: telemetry (EVAL.md §A) appends run stats to ~/.fusion-council — the ONE
// write this otherwise read-only workflow performs. Pass noTelemetry:true for a strictly read-only run.
const noTelemetry = !!(args && args.noTelemetry)

// Read-only guard — belt-and-suspenders on top of each agent's own tool restriction. This is an
// ANALYSIS workflow; nothing may mutate the repo. (Symmetric with codex's -s read-only below.)
const READ_ONLY =
  'You are in read-only deliberation mode. You MAY read files, but you MUST NOT create, modify, or ' +
  'delete any file, and MUST NOT run state-changing commands. Produce only your analysis.\n\n'

// Judge mirrors the Fusion Router. invalidClaims is the merit gate: ANY panelist's (incl. GPT) wrong/
// unsupported claim lands here so synthesis drops it — no source privileged, no source force-included.
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

// GPT-5.5 via local Codex CLI (ChatGPT sub, no metered API). -s read-only = it cannot edit.
// Input via QUOTED heredoc (<<'EOF') -> temp file -> fed to codex on STDIN (`- <"$PIN"`): the heredoc does
// no interpolation, so $ / backticks / quotes in the task or context can't break the command (the old
// inline "<prompt>" arg could). Reading the prompt from stdin instead of argv ALSO removes the ~1MB ARG_MAX
// launch ceiling a long task/context would hit via "$(cat ...)". The `<"$PIN"` redirect still closes stdin
// at EOF, so codex can't hang waiting for input ("Reading additional input from stdin...") even when a long
// xhigh run gets backgrounded — the property the old explicit </dev/null gave, now from the file redirect.
// Failure sentinel (idiomatic here, cf. NO_DIFF / NONE): the seat returns this when codex didn't really
// run, so the filter below drops it and coverage honestly says UNAVAILABLE instead of faking a "ran".
const CODEX_FAIL = 'CODEX_UNAVAILABLE'
const codexRun = (prompt) => () =>
  agent(
    `You drive the local Codex CLI to get GPT-5.5's analysis of a planning task. Do TWO steps in order; ` +
      `do NOT skip step 1.\n` +
      `STEP 1 — run this command verbatim BEFORE writing anything. It is read-only. Copy everything after ` +
      `"PROMPT:" below verbatim between the heredoc markers (a QUOTED heredoc, so the shell does NOT ` +
      `interpolate it):\n` +
      `  PIN=$(mktemp); cat > "$PIN" <<'FUSION_PROMPT_EOF'\n` +
      `<the entire PROMPT block below, verbatim>\n` +
      `FUSION_PROMPT_EOF\n` +
      `  OUT=$(mktemp); codex exec -s read-only --skip-git-repo-check -m ${codexModel} ` +
      `-c model_reasoning_effort="${codexEffort}" -o "$OUT" - <"$PIN"; cat "$OUT"; rm -f "$OUT" "$PIN"\n` +
      `STEP 2 — return ONLY Codex's final answer from step 1's ACTUAL stdout, verbatim, no preamble of your ` +
      `own. Reply with EXACTLY the single token ${CODEX_FAIL} (and nothing else) ONLY IF the command you ran ` +
      `produced no real answer — it errored, timed out, returned nothing, or printed only its banner / ` +
      `"Reading additional input from stdin...". Do NOT reply ${CODEX_FAIL} without running step 1.\n\n` +
      `Ask Codex for TWO terse sections (a few bullets each, not prose): (A) RECOMMENDATION — recommended ` +
      `approach and how to verify; (B) RISKS — key risks, simpler alternatives, and what NOT to do.\n\n` +
      `PROMPT:\n${prompt}`,
    // sonnet, not the inherited Opus: this seat only shells out to codex and returns its output
    // verbatim — GPT-5.5 does the reasoning. Same tier as the context:session Bash-runner below.
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
  if (typeof log === 'function') log('fusion-plan: GPT-5.5 seat returned CODEX_UNAVAILABLE — retrying once')
  return thunk()
}

// 0) Context — TWO read-only sources in parallel. Always runs; no-ops cleanly if a source is empty.
phase('Context')
const [repoMap, sessionBrief] = await parallel([
  () =>
    agent(READ_ONLY + `Map the context for this planning task.\n\n${task}`, {
      agentType: NS + 'context-mapper',
      phase: 'Context',
      label: 'context:repo',
    }),
  () =>
    noContext
      ? Promise.resolve('')
      : // Transcript-brief agent: framed imperatively, NOT with READ_ONLY, because its whole job is to
        // run one read-only Bash command; the "produce only analysis" framing suppresses the Bash call.
        agent(
          `You extract a decision brief from THIS Claude Code session so a model panel can plan in ` +
            `context. Do TWO steps in order; do NOT skip step 1.\n` +
            `STEP 1 — run this one Bash command verbatim before writing anything. It only reads the ` +
            `transcript and prints plain text; it changes no files:\n` +
            `  P="$HOME/.claude/projects/$(pwd | sed 's#/#-#g')/$CLAUDE_CODE_SESSION_ID.jsonl"; ` +
            `[ -f "$P" ] || { echo NO_TRANSCRIPT; exit 0; }; ` +
            `jq -r 'select(.type=="user" or .type=="assistant") | (.message.role) as $r | (.message.content | if type=="string" then . else ([.[]?|select(.type=="text")|.text]|join("\\n")) end) | select(.!="") | "[" + $r + "] " + .' "$P"\n` +
            `STEP 2 — from the command's ACTUAL stdout, write a TIGHT brief (<=400 words): key decisions, ` +
            `their rationale, active constraints, open threads. Drop chit-chat and tooling detail.\n` +
            `Reply with the single token NONE ONLY IF step 1's stdout was empty or exactly NO_TRANSCRIPT.`,
          { model: 'sonnet', phase: 'Context', label: 'context:session' }
        ),
])

const parts = []
if (repoMap && String(repoMap).trim()) parts.push('## Repo context (read-only map)\n' + String(repoMap).trim())
const sb = sessionBrief && String(sessionBrief).trim()
if (sb && sb !== 'NONE' && sb !== 'NO_TRANSCRIPT')
  parts.push('## Session context — prior decisions & rationale\n' + sb)
const ctx = parts.join('\n\n') || '(no extra context resolved)'

const panelPrompt =
  `TASK:\n${task}\n\nCONTEXT:\n${ctx}\n\n` +
  `When you make a claim about EXISTING code, cite the path:line it concerns; if you cannot, prefix that ` +
  `claim with [UNVERIFIED]. This does NOT apply to forward-looking recommendations about code that does ` +
  `not exist yet.`

// 1) Panel — 4 Claude role seats (agentType loads each .md's role prompt + read-only tools) + GPT-5.5.
//    All parallel; the judge needs them together, so a barrier here is correct.
phase('Panel')
const ROLES = duo ? [] : ['fusion-architect', 'fusion-skeptic', 'fusion-test-strategist', 'fusion-maintainer']
const PANEL = [
  ...ROLES.map((r) => ({
    label: r,
    run: () => agent(READ_ONLY + panelPrompt, { agentType: NS + r, phase: 'Panel', label: `panel:${r}` }),
  })),
  // duo arm: one generalist Claude seat, pinned to opus for arm stability, given the same two-section
  // shape the GPT seat gets (it has no role .md to supply coverage) so prompt strength is equal.
  ...(duo
    ? [
        {
          label: 'claude-generalist',
          run: () =>
            agent(
              READ_ONLY +
                panelPrompt +
                `\n\nGive TWO terse sections (a few bullets each, not prose): (A) RECOMMENDATION — ` +
                `recommended approach and how to verify; (B) RISKS — key risks, simpler alternatives, ` +
                `and what NOT to do.`,
              { model: 'opus', phase: 'Panel', label: 'panel:claude-generalist' }
            ),
        },
      ]
    : []),
  { label: `gpt-${codexModel}`, run: withCodexRetry(codexRun(panelPrompt)) },
]

const answers = (
  await parallel(PANEL.map((m) => () => m.run().then((a) => ({ panelist: m.label, analysis: a }))))
)
  .filter(Boolean) // a failed/throttled seat drops to null
  .filter((r) => r.analysis && String(r.analysis).trim())
  .filter((r) => String(r.analysis).trim() !== CODEX_FAIL) // codex didn't really run → drop, don't fake it

if (!answers.length) throw new Error('fusion-plan: no panelist produced output')

const ran = answers.map((a) => a.panelist)
const gptRan = ran.some((l) => l.startsWith('gpt-'))
// GPT failure is recorded, never silently swallowed and never an interactive gate (deterministic).
const coverage = `Seats: ${ran.join(', ')}. GPT-5.5: ${
  gptRan ? 'ran' : 'UNAVAILABLE — Claude-only this run, model diversity reduced'
}.`

// 2) Judge — merit comparison, structured so synthesis can branch without re-reading prose.
// CROSS-FAMILY rule: the 4 Claude role seats share one base model, so their mutual agreement is
// correlated sampling (same-vendor frontier models agree on ~60% of their joint errors — Kim et al.,
// ICML 2025), while GPT's unique claims are single-source BY CONSTRUCTION. Without this rule the
// single-source drop leniency systematically tilts against the council's only cross-family seat and
// gives a shared Opus misreading multi-source cover. Corroboration = both families, nothing less.
phase('Judge')
const judge = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nPanel analyses (JSON):\n${JSON.stringify(answers, null, 2)}\n\n` +
    `Compare on merit — no panelist is privileged. Extract: consensus (prefix items BOTH model families ` +
    `independently raised with [cross-family]); contradictions; uniqueInsights ` +
    `(valuable points only ONE raised — prefix with the panelist); coverageGaps; blindSpots; and ` +
    `invalidClaims (any claim, INCLUDING GPT's, that is wrong, unsupported, or conflicts with the repo/` +
    `constraints — format "panelist: claim — why").\n\n` +
    `GROUNDING: verify only DESCRIPTIVE premises — that cited CURRENT code exists as claimed (use your ` +
    `read-only tools to open a cited path:line; tolerate paraphrase, do NOT require a verbatim quote). Put ` +
    `in invalidClaims (format "panelist: claim — ungroundable") any claim about EXISTING code you cannot ` +
    `tie to real code, and be willing to drop a weakly-grounded SINGLE-SOURCE claim this way; NEVER drop a ` +
    `claim BOTH model families raised without opening the cited code first. CORROBORATION IS CROSS-FAMILY ` +
    `ONLY: the Claude role seats share one base model behind different lenses, so Claude-only agreement is ` +
    `correlated sampling, NOT independent confirmation — hold a Claude-majority claim to the SAME grounding ` +
    `bar as a single-source one, and never count Claude-seat agreement as evidence against the GPT seat's ` +
    `single-raised claim. CRITICAL: this is a pre-implementation plan — ` +
    `NEVER mark a forward-looking "should add/change X" recommendation ungroundable just because the target ` +
    `code does not exist yet. Default-to-invalidClaims on uncertainty applies ONLY to concrete claims about ` +
    `existing code — never to recommendations or judgment calls.`,
  { schema: JUDGE_SCHEMA, model: 'opus', phase: 'Judge', label: 'judge' }
)

// 3) Synthesize — one plan. Keep gold, drop invalidClaims, emit the fixed report. No implementation.
phase('Synthesize')
const plan = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nPanel analyses (JSON):\n${JSON.stringify(answers)}\n\n` +
    `Judge (JSON):\n${JSON.stringify(judge)}\n\nCouncil coverage: ${coverage}\n\n` +
    `Write ONE implementation plan. Keep consensus, resolve contradictions, preserve every uniqueInsight ` +
    `that survived invalidClaims (do NOT drop a surviving point merely for being single-source, and do NOT ` +
    `re-litigate the judge's merit calls; you MAY drop only an item that directly contradicts the repo/` +
    `constraints or would break the output contract, listing it under "Dropped claims" with the reason), ` +
    `fill coverageGaps, avoid blindSpots, and ` +
    `EXCLUDE everything in invalidClaims (list each dropped claim + reason under "Dropped claims"). ` +
    `Prefer the smallest safe change. This is a PLAN ONLY — do not implement.\n\n` +
    `Output EXACTLY this structure:\n` +
    '# Fusion Plan\n## Assumptions\n## Relevant Context (files / patterns / constraints)\n' +
    '## Recommended Plan  (each step -> verify: check)\n' +
    '## Cross-Model Notes (consensus / resolved contradictions / dropped claims + reason)\n' +
    '## Risks & Mitigations\n## Verification Criteria (command/test -> expected result)\n' +
    `## Do Not Do\n## Open Questions\n## Council Coverage  (${coverage})`,
  { model: 'opus', phase: 'Synthesize', label: 'synthesize' }
)

// 4) Telemetry (observational eval, EVAL.md §A) — fail-open; must NEVER break or gate a run.
// The runtime has no fs/process/Date/timers, so ONE seat appends the row via a QUOTED heredoc; the
// SHELL supplies ts/cwd/run_id. `jq -e` validates the row BEFORE append — that guards WELL-FORMEDNESS,
// not fidelity (a copy that stays valid JSON but alters a value is not detectable here; the workflow
// journal keeps ground truth). A copy that fails validation appends a tiny fixed {dropped:true} stub
// instead, so the large-run drop bias stays measurable. Appends take a bounded mkdir lock (≤5s, then
// best-effort) because bench arms run councils in parallel and a judge-sized line exceeds the atomic-
// append boundary. Row is compact (judge entries capped at 500 chars, per-seat counts, NOT full
// answers — the journal keeps those). Single-line JSON means a literal FUSION_TELEMETRY_EOF inside the
// data can't terminate the heredoc (needs its own line). One retry on a missing TELEMETRY_OK (the seat
// can spuriously bail like the codex wrapper; a retry after a BAD may leave stub+row — visible, benign).
// No hard timeout is possible here (no timers) — a hung seat is bounded by the harness agent lifecycle.
// DESCRIPTIVE data only (the judge is the scorer — circular); never a kill-metric input on its own.
if (!noTelemetry)
try {
  const cap = (v) => (Array.isArray(v) ? v.map((s) => String(s).slice(0, 500)) : v)
  const row = JSON.stringify({
    workflow: 'fusion-plan',
    arm: duo ? 'duo' : 'full', // eval arm — joins bench runs to telemetry
    panel: ran,
    gpt_ran: gptRan,
    gpt_retried: gptRetried,
    codexModel,
    codexEffort,
    judge: Object.fromEntries(Object.entries(judge).map(([k, v]) => [k, cap(v)])),
    coverage,
    seats: answers.map((a) => ({
      panelist: a.panelist,
      chars: String(a.analysis).length,
      // bullet/numbered lines ≈ claim count: the survival-per-claim denominator (Goodhart guard)
      claims: String(a.analysis)
        .split('\n')
        .filter((l) => /^\s*([-*•]|\d+[.)])\s/.test(l)).length,
    })),
    subject_head: String(task).slice(0, 200),
  })
  const send = () =>
    agent(
      `Append one telemetry row. Run this command verbatim. The heredoc body is ONE single line of JSON — ` +
        `copy it EXACTLY, character-for-character, no reformatting:\n` +
        `  F=$(mktemp); cat > "$F" <<'FUSION_TELEMETRY_EOF'\n` +
        `${row}\n` +
        `FUSION_TELEMETRY_EOF\n` +
        `  D="$HOME/.fusion-council"; mkdir -p "$D"; RID="$(date -u +%s)-$$-$RANDOM"\n` +
        `  for i in $(seq 1 50); do mkdir "$D/.lock" 2>/dev/null && break; sleep 0.1; done\n` +
        `  if jq -e . "$F" >/dev/null 2>&1; then jq -c --arg ts "$(date -u +%FT%TZ)" --arg cwd "$PWD" ` +
        `--arg rid "$RID" '. + {ts:$ts,cwd:$cwd,run_id:$rid}' "$F" >> "$D/telemetry.jsonl" && echo TELEMETRY_OK; ` +
        `else jq -cn --arg ts "$(date -u +%FT%TZ)" --arg cwd "$PWD" --arg rid "$RID" ` +
        `'{dropped:true,workflow:"fusion-plan",ts:$ts,cwd:$cwd,run_id:$rid}' >> "$D/telemetry.jsonl"; ` +
        `echo TELEMETRY_BAD; fi\n` +
        `  rmdir "$D/.lock" 2>/dev/null; rm -f "$F"\n` +
        `Return ONLY the command's final output line.`,
      { model: 'sonnet', phase: 'Synthesize', label: 'telemetry' }
    )
  let ack = await send()
  if (!/TELEMETRY_OK/.test(String(ack))) ack = await send()
  if (!/TELEMETRY_OK/.test(String(ack)) && typeof log === 'function')
    log('fusion-plan: telemetry row dropped (seat did not confirm a valid append)')
} catch (e) {
  if (typeof log === 'function') log('fusion-plan: telemetry skipped: ' + e)
}

return { plan, judge, coverage, panel: ran, contextInjected: ctx !== '(no extra context resolved)' }
