# Changelog

## 0.1.10

Harden the `fusion-review` capture seat against a flaky failure, and add an empirical benchmark that
measures the council instead of asserting its value.

- **Fix: retry + lenient parse in the capture seat.** The haiku capture seat occasionally dropped the
  `===FUSION_DIFF_PATH===` marker line (echoing the diff body but stripping the "preamble" marker), which
  threw `capture produced neither a diff-path marker nor NO_DIFF` mid-run. Capture now retries up to 3x and,
  if the marker is gone but the diff body survived (`---DIFF---` present), reviews it anyway (the GPT seat,
  which needs the temp-file path, then honestly reports UNAVAILABLE). Only a clean `NO_DIFF` is "nothing to
  review"; a persistently unparseable result still throws. Applies to `fusion-review`.
- **Add: `bench/` — an empirical review benchmark.** A reusable harness (leak-free case reconstruction,
  real shipped-path runs, blind quote-required grading cross-validated 12/12 by a GPT-5.5 grader) that
  measures whether the council out-detects a single strong model, whether the GPT-5.5 seat adds value, and
  at what cost. See `bench/README.md`. Directional early findings (small n): single-opus matches the council
  on focused diffs; the council's recall edge is on large diffs; the GPT-5.5 seat showed no measurable
  benefit. Case datasets are derived from a private repo and are gitignored.
- **Add: bench-only `args.seats` roster param in `fusion-review`.** Lets the benchmark drop the GPT seat for
  the claude-only ablation. Not exposed via the skill; no-args behavior is byte-identical to before.

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
