# Changelog

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
