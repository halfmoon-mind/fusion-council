# Changelog

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
