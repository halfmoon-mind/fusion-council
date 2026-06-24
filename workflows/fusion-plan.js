export const meta = {
  name: 'fusion-plan',
  description:
    'Deterministic read-only planning council: Claude role panel (architect/skeptic/test/maintainer) + GPT-5.5, judged and synthesized into one implementation plan. Every invocation runs the full pipeline — no skip gate.',
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
// ChatGPT sub only runs gpt-5.5 / gpt-5.4; xhigh = quality-first (pass codexEffort:'low' for speed).
const codexModel = (args && args.codexModel) || 'gpt-5.5'
const codexEffort = (args && args.codexEffort) || 'xhigh'
const noContext = !!(args && args.noContext)

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
// Input via QUOTED heredoc (<<'EOF') -> temp file -> "$(cat file)" as the prompt arg: the shell does
// no interpolation, so $ / backticks / quotes in the task or context can't break the command (the old
// inline "<prompt>" arg could). </dev/null is STILL REQUIRED: codex exec waits for stdin EOF ("Reading
// additional input from stdin...") even with a prompt arg, so an open-pipe stdin (e.g. a long xhigh run
// that gets backgrounded) hangs it forever and -o "$OUT" is never written. Closing stdin keeps it deterministic.
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
      `-c model_reasoning_effort="${codexEffort}" -o "$OUT" "$(cat "$PIN")" </dev/null; cat "$OUT"; rm -f "$OUT" "$PIN"\n` +
      `STEP 2 — return ONLY Codex's final answer from step 1's ACTUAL stdout, verbatim, no preamble of your ` +
      `own. Reply with EXACTLY the single token ${CODEX_FAIL} (and nothing else) ONLY IF the command you ran ` +
      `produced no real answer — it errored, timed out, returned nothing, or printed only its banner / ` +
      `"Reading additional input from stdin...". Do NOT reply ${CODEX_FAIL} without running step 1.\n\n` +
      `Ask Codex for: recommended approach, key risks, what NOT to do, and how to verify.\n\n` +
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
const withCodexRetry = (thunk) => async () => {
  const first = await thunk()
  if (first && String(first).trim() !== CODEX_FAIL) return first
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

const panelPrompt = `TASK:\n${task}\n\nCONTEXT:\n${ctx}`

// 1) Panel — 4 Claude role seats (agentType loads each .md's role prompt + read-only tools) + GPT-5.5.
//    All parallel; the judge needs them together, so a barrier here is correct.
phase('Panel')
const ROLES = ['fusion-architect', 'fusion-skeptic', 'fusion-test-strategist', 'fusion-maintainer']
const PANEL = [
  ...ROLES.map((r) => ({
    label: r,
    run: () => agent(READ_ONLY + panelPrompt, { agentType: NS + r, phase: 'Panel', label: `panel:${r}` }),
  })),
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
phase('Judge')
const judge = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nPanel analyses (JSON):\n${JSON.stringify(answers, null, 2)}\n\n` +
    `Compare on merit — no panelist is privileged. Extract: consensus; contradictions; uniqueInsights ` +
    `(valuable points only ONE raised — prefix with the panelist); coverageGaps; blindSpots; and ` +
    `invalidClaims (any claim, INCLUDING GPT's, that is wrong, unsupported, or conflicts with the repo/` +
    `constraints — format "panelist: claim — why").`,
  { schema: JUDGE_SCHEMA, model: 'opus', phase: 'Judge', label: 'judge' }
)

// 3) Synthesize — one plan. Keep gold, drop invalidClaims, emit the fixed report. No implementation.
phase('Synthesize')
const plan = await agent(
  READ_ONLY +
    `${panelPrompt}\n\nPanel analyses (JSON):\n${JSON.stringify(answers)}\n\n` +
    `Judge (JSON):\n${JSON.stringify(judge)}\n\nCouncil coverage: ${coverage}\n\n` +
    `Write ONE implementation plan. Keep consensus, resolve contradictions, preserve every uniqueInsight ` +
    `(do NOT drop a point just because one panelist raised it), fill coverageGaps, avoid blindSpots, and ` +
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

return { plan, judge, coverage, panel: ran, contextInjected: ctx !== '(no extra context resolved)' }
