# Changelog

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
