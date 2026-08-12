# Changelog

## 0.4.0

`fusion-plan` adopts the merged judge+synthesize call `fusion-review` has run since 0.3.0, and the
four Claude role agents get a per-section brevity cap. Both changes attack the same thing — the
volume of low-signal claims the judge has to adjudicate. Motivating telemetry (181 real runs,
`~/.fusion-council`): the plan council's role seats emit 28–40 bullet-claims per run each (~143/run
total) while the GPT seat produces the SAME unique-insight yield as the architect seat (68 vs 68)
from a third of the claims (312 vs 860); plan `invalidClaims` runs 5.5/run against merged review's
1.48/run.

- **Change: merged judge+synthesize is the plan default.** Same structure as 0.3.0's review change
  (schema = the judge fields + `plan`), same rationale: the synthesizer was forbidden to re-litigate
  merit calls, and the `correctedFindings` sink was a judge→synthesizer HANDOFF bug. **Ported on the
  review arm's bench, NOT benched on plan** — §C plan A/B still has never run. Reversible; criteria
  below and in EVAL.md §B0. `args: { splitSynth: true }` restores the two-call pipeline;
  `args: { mergedSynth: true }` is a no-op, symmetric with review. Judge/plan instruction text is
  shared verbatim between both paths, so the flag flips architecture only. Telemetry `arm` gains the
  `-merged` suffix (`full-merged` is the new default arm string).
- **Change: brevity cap on all four role agents** — "at most 3 bullets per section, highest-signal
  first; omit a section rather than padding it." Caps a 5–6 section seat at ~15 claims, near the GPT
  seat's measured density. Rationale is the Goodhart guard from EVAL.md §3: an uncapped seat gets a
  free `uniqueInsights` lottery ticket per extra claim with no observable penalty, and ~82% of plan
  claims are discarded by the judge today.
- **Guard: typed merged-return check** — a missing/empty/non-string `plan` throws instead of shipping
  `plan: undefined` (and a raw-string return can't be rest-spread into a fake `judge`).
- **Eval: `eval/smoke_plan.mjs`**, the offline stub-runner for the plan workflow (both branches,
  string-args normalization, missing-`task` throw). Mirrors `smoke_review.mjs`; no subagents, no cost.
- **Measurement debt, disclosed (EVAL.md §B0):** (a) the role `.md`s are SHARED with
  `fusion-review`'s `args.roles` arm, so the cap invalidates the historical `full`/`nogpt` bench rows
  as comparators — they are prompt-era-stale, not re-run; (b) both changes land in the same telemetry
  window, so a post-change improvement cannot be attributed to one or the other; (c) telemetry is
  judge-circular (§3 MAJOR) and remains descriptive-only — it motivated this change, it cannot
  validate it.

## 0.3.0

`fusion-review`'s judge and synthesizer are now **one merged opus call**: the seat that grounds and
gates the panel's claims writes the final report from its own verdict in the same response
(schema = the judge fields + `report`). Rationale: the synthesizer did no independent verification
(it was forbidden to re-litigate merit calls), and both measured post-judge information losses —
the `correctedFindings` sink (0.1.13) and the assertion demotion — were judge→synthesizer HANDOFF
bugs; merging removes that seam class outright and saves the pipeline's second-largest input pass.
`fusion-plan` keeps the two-call pipeline (unvalidated there).

- **Change: merged judge+synthesize is the review default.** Bench 2026-08-05 with same-era duo
  re-runs (opus-5 + gpt-5.6-sol both arms; the July §B5′ duo rows are gpt-5.5/opus-4.8-era and not
  comparable): recall tie — 5/5 seeded bugs including the one solo-prescreened hard case (n=1 =
  anecdote, per the §B5′ rule); clean-case noise (unaudited audit-pile counts) lower on all three
  runnable cleans (3/8/5 vs 4/11/7 — the feared same-call `invalidClaims` softening did not appear,
  it pointed the other way); cost −7%, wall −7% on the same-era pairs. Reversible default with
  pre-registered reversion criteria in EVAL.md §B0 (hand-audit of the audit piles is still owed;
  intra-call demotion is watchable by diffing telemetry `judge` vs the report).
- **Add: `args.splitSynth` restores the two-call pipeline.** `args.mergedSynth` is now a legacy
  no-op (merged IS the default). Judge/report instruction text is shared verbatim between both
  paths, so the flag flips architecture only. Telemetry `arm` gains a `-merged` suffix recording
  the ACTUAL configuration (`duo-merged` is the new default arm string). Known, disclosed confound:
  the merged report travels as a schema string field, the split one as free text (EVAL.md §B0).
- **Guard: typed merged-return check** — a missing/empty/non-string `report` throws instead of
  shipping `review: undefined` (and a raw-string return can't be rest-spread into a fake `judge`).
- **Eval: `duo-merged` bench arm** (`eval/run_case.sh`, all telemetry/gpt/relay guards) and
  `eval/smoke_review.mjs`, an offline stub-runner asserting both pipeline branches' call shapes —
  the cheap check the bench lacked (a branch typo used to surface only mid-bench at ~$2/attempt).
  The historical full/nogpt/duo arms now pin `splitSynth:true` (no-op pre-0.3.0).
- **Bench incidents (recorded in EVAL.md §B0):** case 020's source repo vanished from disk
  (excluded_d1 — repair or retire); duo-merged case-018 attempt 1 died pre-telemetry twice
  (arm-assert caught both, attempt 2 clean) — undiagnosed, watching the retry base rate.

## 0.2.1

Model bump on both council axes; no pipeline or default-panel changes.

- **Change: GPT seat defaults to `gpt-5.6-sol`** (was `gpt-5.5`). Verified live on the ChatGPT-sub
  Codex CLI (v0.145.0) at both `high` and `xhigh` reasoning effort — the old "sub only runs 5.5/5.4"
  constraint no longer holds. The ~1.6x high-vs-xhigh speed A/B was measured on gpt-5.5 and has not
  been re-run on 5.6 (flagged in-code). `args.codexModel: "gpt-5.5"` rolls back per run.
- **Change: Claude seats pinned to `claude-opus-5`** (was the `opus` harness alias, resolving to
  4.8). Applies to the judge/synthesize/generalist seats in both workflows and the 4 role-agent
  frontmatters. Verified: a role agent boots and reports `claude-opus-5`. Sonnet-tier relay seats
  (GPT wrapper, capture/context) are unchanged.
- **Docs:** README / SKILL.md / plugin manifests now say GPT-5.6 Sol.

## 0.2.0

The review council's default panel is now the bench-validated **duo** — one generalist Claude seat +
GPT-5.5, judged and synthesized exactly as before. The full Claude role panel stays one flag away
(`args.roles: true`), and `fusion-plan` is unchanged.

- **Change: `fusion-review` defaults to duo.** A post-0.1.13 re-run of the seeded-defect bench (9
  settled cases × duo/full; pre-patch rows quarantined) measured duo at-or-above the role panel on the
  §B5′ primary metrics: identical recall (easy 4/4, hard 1/1 — both arms now assert the one hard
  case's defect as a High finding, confirming the 0.1.13 routing fixes repaired both measured loss
  paths), clean-diff FP floor 2.0 vs ~3.5–4.75 findings/run, cost −21% ($1.85 vs $2.34/run), wall
  −17%. Raw noise/SNR proxies differ by ≤0.2 findings/run in the role panel's favor — inside
  demonstrated grader inconsistency (EVAL.md records both raw and hand-normalized counts). This is NOT
  a role-panel deletion: no §D kill metric fired (the hard subset is n=1); it is a reversible default
  with pre-registered reversion criteria in EVAL.md (acted-on-rate drop, two verified
  role-panel-only misses, or a guarded bench extension reversing the order).
- **Add: `args.roles` restores the role panel** (skeptic / test-strategist / maintainer + GPT-5.5).
  `args.duo` is now a no-op (duo IS the default); `noGpt` composes with both (`roles` + `noGpt`
  reproduces the historical nogpt bench arm). The telemetry `arm` field records the ACTUAL
  configuration per run: `duo` (default), `full`, `nogpt`, `duo-nogpt`.
- **Eval: `run_case.sh` arm mapping** — the full/nogpt arms opt back into the role panel via
  `roles:true`; the duo arm keeps sending the legacy flag so the mapping stays valid against
  pre-0.2.0 workflows.
- **Docs: README / review skill / EVAL.md** — duo-default rationale; EVAL.md gains the §B5′
  re-validation block and the pre-registered reversion guardrails (plus the `eval/ack.sh` acted-on
  habit they depend on).

## 0.1.13

Two classes of measured signal loss, found by the new seeded-defect bench (EVAL.md §B5′), plus the
bench harness itself. The headline product bug: headless orchestrators sometimes pass Workflow `args`
as a JSON-encoded STRING, so `"{\"noGpt\": true}".noGpt` is undefined and both workflows silently
ignored their ablation flags — every "nogpt"/"duo" bench run secretly executed as full until the
telemetry `arm` field exposed it.

- **Fix: normalize string `args` in both workflows.** A JSON-looking string arg is parsed before any
  flag read; a plain task string still works for `fusion-plan`. The bench runner also asserts
  requested-arm == telemetry-arm and retries, so a recurrence is loud, not silent.
- **Add: `correctedFindings` in both judge schemas.** Synthesis excludes `invalidClaims` wholesale, so
  a judge refutation of an EXCULPATORY claim ("this change is fine") was an information sink — the
  bench measured a real seeded bug lost exactly this way (the judge articulated the defect inside its
  refutation; the report never asserted it). The judge now emits the corrected positive finding as a
  first-class item; review synthesize includes it under Findings (Raised by: judge), plan synthesize
  treats it as a surviving insight.
- **Change: review synthesize may never demote an assertion.** A consensus/uniqueInsights/
  correctedFindings item asserting a concrete defect must land in `## Findings` — not be rephrased
  into Open Questions/Test Gaps (the second measured loss: a panel-raised true bug demoted to a
  question by the 0.1.10 asks-don't-assert routing). Open Questions stays interrogative-only.
- **Add: seeded-defect bench harness** (`eval/run_case.sh`, `grade_case.sh`, `run_bench.sh`,
  `bench_report.sh`): scratch clones with scrubbed git history, five arms (full / nogpt / duo / solo /
  solo-k with an equalized dimension checklist), gpt_ran + arm integrity gates, wall-clock + cost per
  run, decoy-cited findings routed to an audit pile (never auto-FP), resume-safe reruns, and the §B5′
  per-arm scoreboard. `eval/cases/` and `eval/results/` are gitignored — they can embed private-repo
  code and must never publish.
- **Docs: EVAL.md** records the pilot and the first full §B5′ read: solo-saturation (a cheap
  single-model reviewer caught ~90% of 20 deliberately-hardened, verified-real seeded bugs, whether or
  not the buggy path had test coverage), the §B5′ metric re-rank (precision/noise/cost over recall),
  and the two routing-loss mechanisms above — all descriptive, tiny n, no kill metric triggered.

## 0.1.12

Capture relay hardening. A real-usage fusion-review run (large iOS/Android diff) failed before the panel
even started: the capture seat RAN its git command correctly but replied "The output was already captured
verbatim in the tool result above." plus a partial copy that dropped the `===FUSION_DIFF_PATH===` marker
line the workflow keys on. The marker travels through an LLM's final message, so this is the same
relay-bail class as the GPT seat's spurious `CODEX_UNAVAILABLE` — and it happened on an opus-pinned seat,
so a stronger model is not the fix.

- **Change: capture prompt demands a byte-for-byte stdout copy** whose FIRST line is the marker /
  `NO_DIFF` / `CAPTURE_FAILED` — explicitly banning commentary, code fences, and "output captured above"
  paraphrase. Field-validated: resuming the failed run with this prompt echoed the marker correctly.
- **Add: one capture retry on a marker-less reply** (cf. `withCodexRetry`): capture is read-only and
  idempotent, so a relay bail gets a second attempt before the run fails loudly; `NO_DIFF` never
  retries. Telemetry gains `capture_retried` so the bail base rate is measurable from real usage.

## 0.1.11

Make the council **measure itself** instead of arguing from vibes. A two-round adversarially-verified
literature sweep (recorded in `EVAL.md`) said the honest answer to "is a 4-Claude + 1-GPT council worth it?"
is *conditional*: cross-family membership and a grounded judge are the two mechanisms the evidence supports;
role-seat fan-out and merge-style synthesis are unvalidated; and the judge's single-source drop rule was
structurally tilted against the council's only cross-family seat (GPT's unique claims are single-source BY
CONSTRUCTION, while same-family Opus seats hand each other multi-source cover — same-vendor frontier models
agree on ~60% of their joint errors, Kim et al. ICML 2025). This release fixes the tilt and lands the
instrumentation + ablation arms that let real usage and a seeded-bug bench settle the rest.

- **Change: judge corroboration is CROSS-FAMILY ONLY (both workflows).** Claude-only agreement is
  correlated sampling, not independent confirmation: a Claude-majority claim now gets the SAME grounding
  bar as a single-source one, Claude-seat agreement never counts against the GPT seat's single-raised
  claim, and (review) GPT's findings are judged against the diff it actually saw. The judge also tags
  consensus items both families independently raised with `[cross-family]`, so error-decorrelation is
  measurable from telemetry.
- **Add: run telemetry (observational self-eval, `EVAL.md` §A).** After Synthesize, one sonnet seat
  appends a compact row (judge JSON capped at 500 chars/entry, per-seat `{chars, claims}`, coverage,
  `arm`, `gpt_ran`/`gpt_retried`, `subject_head`) to `~/.fusion-council/telemetry.jsonl`. The workflow
  runtime has no fs/Date/timers, so the SHELL supplies `ts`/`cwd`/`run_id`; `jq -e` validates before
  append (well-formedness, not fidelity — journals keep ground truth); a failed copy appends a
  `{dropped:true}` stub so drop bias stays measurable; appends take a bounded mkdir lock (bench arms run
  in parallel); fail-open + one retry — telemetry can never break or gate a run. **`args.noTelemetry`
  disables it**; the write is disclosed in both meta descriptions since it is the one write these
  otherwise read-only workflows perform.
- **Add: `eval/analyze.sh` + `eval/ack.sh`.** Per-seat scoreboard from real usage (surviving
  uniqueInsights per run/claim, decisive-run rate, FP rate, `[cross-family]` consensus rate, dropped
  rows) and a one-keystroke acted-on annotation — the only non-circular observational signal.
- **Add: eval ablation args — `noGpt` (review) and `duo` (both workflows).** `duo` = ONE generalist opus
  seat + GPT + the same judge/synthesize: the literature-pointed comparator the full role panel must beat
  (~half cost). Default OFF; telemetry rows carry the `arm` so bench runs join cleanly.
- **Add: `EVAL.md` — the validation methodology.** Verified research (both sweeps + corrections),
  observational first-cut over 104 historical judge outputs, the seeded-defect benchmark design (4 arms),
  blinded plan A/B with a non-panel-family grader, kill metrics with statistical guardrails, and the
  11-flaw methodology attack. A live fusion-review run of this very diff validated the telemetry seat and
  contributed 6 fixes (lock, stub, run_id, opt-out, kill-match containment, comment honesty).

## 0.1.10

Give `fusion-review` a first-class **Open Questions** section so the honest-recall signal the judge already
produces (`coverageGaps` / `blindSpots`) — plus the unstated assumptions a diff leaves open — is surfaced to
the reader instead of being folded into Findings and lost. This is the one recall move an LLM does honestly:
it ASKS rather than asserts, so it adds no false positives, and it mirrors the `## Open Questions` slot
`fusion-plan` already ships. Chosen over building a separate code-derived "case" council: a three-run A/B
evaluation (naive anchor-count → reversed-fix outcome → injected-bug / cross-file with clean controls) never
showed such a generator catch a real bug the existing role seats' coverage missed — the cheap path matched it
every time — so the evidence did not justify the new machinery (kept shelved behind that unmet bar).

- **Add: `## Open Questions` section in `fusion-review`'s synthesized report**, placed before Council
  Coverage (consistent with `fusion-plan`). The synthesize prompt now ROUTES the judge's
  `coverageGaps`/`blindSpots` plus any unstated assumptions / unspecified requirements into it, phrased as
  questions tied to a `path:line` where possible. It asserts nothing ungroundable, so it does not
  reintroduce the false positives the 0.1.6–0.1.9 precision arc removed; the fixed output contract is
  otherwise unchanged (still no dropped-claims slot, `invalidClaims` still silently excluded).

## 0.1.9

Sharpen the single GPT-5.5 seat's prompt instead of adding seats. We evaluated splitting GPT into two
role-lens seats to "balance" the 4-Claude / 1-GPT panel and rejected it on merit: same-model seats add zero
model-family diversity, and two GPT answers agreeing would read as cross-model "consensus" to the
family-blind judge — shielding a shared GPT error from the single-source merit drop. The one seat now asks
for two terse sections instead.

- **Change: GPT seat prompt → two labeled sections in both workflows.** `fusion-plan` asks for
  (A) RECOMMENDATION (approach + how to verify) and (B) RISKS (key risks, simpler alternatives, what NOT to
  do); `fusion-review` asks for (A) CORRECTNESS (regression / coupling / overengineering) and (B) TESTS &
  SCOPE (missing tests, out-of-scope changes). Same coverage as before, but the judge gets the constructive
  and adversarial points cleanly separated for merit comparison.
- **Add: brevity cap on the plan GPT seat** ("a few bullets each, not prose"). The seat previously had no
  length bound; `fusion-review` already caps output via `REVIEW_FRAMING`'s "be terse and actionable", so
  output stays at or below the old length despite the richer structure.
- **Add: rationale comments — GPT stays ONE seat, not N.** Both workflows now document why multiple
  same-family seats weaken the merit gate (intra-model agreement masquerading as cross-model consensus), so
  the single-seat design is not re-litigated.

## 0.1.8

Teach the councils to catch fail-open defaults and defensive-code smear — a failure mode the existing
"smallest safe change" framing never named. The role seats now treat fail-closed as the default and flag
error-swallowing fallbacks and guards buried in internal logic instead of at trust boundaries.

- **Add: fail-closed lens in the skeptic seat.** `fusion-skeptic` now flags fallbacks / try-catch /
  graceful degradation that swallow errors instead of surfacing them (they hide bugs and stretch their
  lifecycle), and flags defensive code smeared through internal logic rather than placed at trust
  boundaries (untrusted input, I/O, external calls) — any guard that does not trace to a real, reachable
  failure. Fail-open is a deliberate boundary call, never an internal-logic default. Runs in both
  `fusion-plan` and `fusion-review` (skeptic seats both).
- **Add: fail-closed + root-cause guidance in the architect seat.** `fusion-architect` now prefers
  fail-closed, places error handling only at trust boundaries where it guards a real, reachable failure
  (not graceful degradation smeared through internal logic), and for a bug fix targets the root cause,
  not the symptom. Planning-only (`fusion-review` has no architect seat).

## 0.1.7

Cut GPT-5.5 (Codex CLI) seat latency — the slowest seat in the parallel panel barrier — by lowering its
default reasoning effort, with no measurable quality drop.

- **Change: default `codexEffort` from `xhigh` to `high` in both workflows.** The GPT-5.5 seat is a
  `parallel()` barrier seat, so the whole Panel phase waits on it; session history showed real `codex exec`
  calls at xhigh running 50–156s (median ~85s) vs Claude role seats ~50–80s, making it the latency long pole.
  A controlled A/B on identical input measured xhigh ≈ 1.6× the wall of `high` (23.6s vs 14.8s) with no gain
  in answer quality or length, so `high` is the new default. Pass `codexEffort:'xhigh'` per run for the
  hardest tasks, `'low'` for raw speed. The global `~/.codex/config.toml` is left unchanged (it governs
  interactive codex / codex-rescue, not these workflows, which pass `-c model_reasoning_effort` explicitly).
  Applies to both `fusion-plan` and `fusion-review`.

## 0.1.6

Reduce false positives in the judge/synthesize stages: ground panelist findings against real code before they
reach the report, instead of carrying any plausible-sounding claim through.

- **Add: the judge re-grounds every concrete code claim before keeping it.** Each judge prompt now confirms a
  cited `path:line` / quoted code against the embedded diff (`fusion-review`) or by opening the file with its
  read-only tools, tolerating paraphrase, and drops ungroundable concrete claims — and weakly-grounded
  single-source findings — into `invalidClaims`. Consensus / cross-model findings are never dropped for being
  single-raised. Applies to both `fusion-plan` and `fusion-review`.
- **Add: plan-mode carve-out for forward-looking recommendations.** `fusion-plan` runs before implementation,
  so its judge verifies only DESCRIPTIVE premises (cited *current* code exists as claimed) and never marks a
  "should add/change X" recommendation ungroundable just because the target code does not exist yet.
- **Change: keep a single merit gate, with a narrow synthesize backstop.** Synthesis no longer force-includes
  single-source findings and must not re-litigate the judge's merit calls; it may drop only an item that
  directly contradicts the diff/repo or would break the output contract. `fusion-review` excludes silently
  (its fixed output structure has no dropped-claims slot); `fusion-plan` lists drops under "Dropped claims".
- **Add: panelist citation discipline.** The shared framing asks each seat to cite the `path:line` a concrete
  code claim concerns, or prefix it `[UNVERIFIED]` (an advisory prose marker, parsed nowhere). In review mode
  an out-of-hunk line is valid only if it bears on behavior the diff changes, so unrelated pre-existing issues
  are not promoted into a diff-scoped review.

## 0.1.5

Remove the ~1MB ARG_MAX launch ceiling on the GPT-5.5 (Codex CLI) seat so large tasks/diffs can't silently
fail to start codex.

- **Fix: feed the codex prompt on stdin (`-o "$OUT" - <file`) instead of expanding it into argv via
  `"$(cat file)"`.** A long task/context (`fusion-plan`) or a large diff (`fusion-review`) was passed as a
  single `codex exec` argv argument, so once it exceeded the OS `ARG_MAX` (~1MB) the command failed to launch
  — the seat went UNAVAILABLE on exactly the big inputs that most need GPT-5.5. The prompt is now read from
  stdin (codex's documented `-` / piped-stdin behavior), which has no argv/`ARG_MAX` ceiling (the
  model's context-window limit still applies). The `<file` redirect
  still closes stdin at EOF, so the backgrounded-long-run hang the old explicit `</dev/null` prevented stays
  fixed — the EOF now comes from the prompt file itself. No timeout was added: a genuinely long high-effort
  run is allowed to finish rather than be killed. Applies to both `fusion-plan` and `fusion-review`.

## 0.1.4

Stop the GPT-5.5 (Codex CLI) seat from silently going UNAVAILABLE because its sonnet wrapper returned the
failure sentinel without ever running codex.

- **Fix: the codex seat wrapper leads with an imperative "STEP 1 — run this command before writing
  anything"** (mirroring the reliable capture / transcript Bash-runner seats) instead of foregrounding the
  failure sentinel. The seat was observed returning `CODEX_UNAVAILABLE` with zero Bash calls ~half the time
  — sometimes twice in a row; with the STEP-1-first framing a follow-up probe ran codex in every sample
  (4/4). Applies to both `fusion-plan` and `fusion-review`.
- **Add: retry the codex seat once on a sentinel result.** A genuine codex outage stays `CODEX_UNAVAILABLE`
  on the retry too (and is honestly dropped from coverage), but a spurious bail usually runs the second
  time. Only the failure path pays the extra attempt.
- **Harden: the retry's `log(...)` call is `typeof`-guarded** so a runtime that does not inject the `log`
  workflow global cannot throw a `ReferenceError` on the failure path and defeat the retry.

## 0.1.3

Reliability for the GPT-5.5 (Codex CLI) review seat and the `fusion-review` diff-capture path.

- **Fix: the GPT-5.5 review seat reads the diff from a file instead of re-typing it.**
  The seat used to make the sonnet wrapper retype the entire diff into a heredoc, so a
  large diff could be silently truncated/reordered while coverage still said "ran". The
  capture step now writes its snapshot to a temp file and the seat `cat`s that file
  straight into `codex` — no LLM transcription of the diff — and all seats derive from
  the one capture snapshot, so the GPT seat and the Claude role seats can't diverge.
  (The diff is still passed as a single `codex exec` argv, so a >~1MB diff remains
  ARG_MAX-bound — unchanged from before.)
- **Fix: a `git diff` error no longer masquerades as a reviewable diff.** Capture now
  branches on the exact `git diff --quiet` exit code (0 = no diff, 1 = diff, >1 = error),
  so a git failure yields a `CAPTURE_FAILED` token and the workflow throws instead of
  silently reviewing a partial/empty diff. The path marker is emitted *before* the diff
  so it survives even if the capture seat truncates its own returned output.
- **Fix: the GPT-5.5 seat must run codex before reporting it unavailable.** Both
  `fusion-plan` and `fusion-review` wrappers were observed returning the
  `CODEX_UNAVAILABLE` sentinel without ever invoking codex; they are now told they MUST
  run the command and base the sentinel only on its real output (reduces, does not
  eliminate, spurious unavailability).
- **Change: single-source the review framing** shared by the Claude role seats and the
  GPT seat so the two model families can't drift, and document the new capture-failure
  `throw` in the `fusion-review` skill.

## 0.1.2

Hardening for the GPT-5.5 (Codex CLI) panel seat input.

- **Fix: pass the prompt via a quoted heredoc instead of an inline arg.** The seat
  built `codex exec ... "<the prompt>"` by inlining the task/diff into a
  double-quoted argument, so shell metacharacters in that text (`$`, backticks,
  `$(...)`, embedded quotes) expanded or truncated the command — corrupting or
  dropping what reached Codex, and opening a command-substitution surface. The
  prompt now goes through a quoted heredoc (`<<'EOF'`) into a temp file, passed as
  `"$(cat "$PIN")"`. Verified: byte-for-byte passthrough of a hostile diff, where
  the old form lost a line and expanded `$HOME`. (`</dev/null` and the
  `CODEX_UNAVAILABLE` sentinel are unchanged.)
- **Change: pin the seat's wrapper agent to `sonnet`.** It only shells out to
  `codex exec` and returns the output verbatim — GPT-5.5 does the reasoning — so the
  inherited Opus was wasted on a subprocess driver. Same tier as the existing
  context/diff Bash-runner seats; no effect on output quality.

## 0.1.1

Reliability fixes for the GPT-5.5 (Codex CLI) panel seat.

- **Fix: close stdin (`</dev/null`) on the `codex exec` call.** Without it codex
  waits for stdin EOF (`Reading additional input from stdin...`) even when given a
  prompt arg, so the seat hung indefinitely whenever the call was backgrounded on a
  long high-effort run — `-o "$OUT"` was never written and no output came back. The
  seat is now deterministic (verified: same command hangs without it, completes in
  ~9s with it at `xhigh`).
- **Fix: stop reporting a failed GPT-5.5 seat as "ran".** Coverage previously
  counted the seat as present whenever its subagent returned any non-empty text, so
  a codex failure leaked an apology / scraped text into the judge and synthesis and
  the Council Coverage line said "ran". The seat now returns a `CODEX_UNAVAILABLE`
  sentinel on failure and is dropped from the panel, so coverage honestly says
  UNAVAILABLE and failure text is never ingested.

## 0.1.0

- Initial release: `fusion-plan` and `fusion-review` read-only multi-model councils.
