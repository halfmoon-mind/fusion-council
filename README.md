# Fusion Council

![Fusion Council hero illustration showing multiple read-only review perspectives converging into a synthesized report](assets/fusion-council-hero.png)

Two deterministic, read-only **councils** for Claude Code that vet your work with
more than one model family before you commit to it:

- **`/fusion-council:fusion-plan <task>`** — before a non-trivial change. A Claude
  role panel (architect · skeptic · test-strategist · maintainer) plus **GPT-5.5**
  deliberate in parallel; a judge compares them on merit and one plan is synthesized.
- **`/fusion-council:fusion-review`** — after the change. The same idea over your
  current `git diff` (skeptic · test-strategist · maintainer + GPT-5.5) → one findings report.

Both are **read-only**: panelists may read the repo but never edit it. Only you (the
main session) implement, and only after you approve.

## Install

```
/plugin marketplace add halfmoon-mind/fusion-council   # or: /plugin marketplace add /path/to/this/repo
/plugin install fusion-council@fusion-council
```

Local testing without GitHub: point the marketplace at this directory directly
(`/plugin marketplace add .` from the repo root).

## Use

```
/fusion-council:fusion-plan add rate limiting to the upload endpoint
# ...review the plan, approve, implement...
/fusion-council:fusion-review
```

## The GPT-5.5 seat (optional)

The non-Claude panel seat shells out to the local **Codex CLI** (`codex exec`,
ChatGPT subscription — no metered API). If `codex` isn't installed — or a run fails
or times out — that seat drops out and the council runs Claude-only; every report's
**Council Coverage** line says so, so reduced diversity is never silent. Install
Codex CLI to enable it. The seat hands its prompt to `codex exec` on **stdin**
(the `-` / piped form, so large tasks/diffs aren't capped by `ARG_MAX`), which
needs a Codex CLI recent enough to support it (verified on v0.142.0); an older
CLI just shows up as UNAVAILABLE in Council Coverage.

## Layout

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   one-plugin marketplace (this repo)
agents/                           5 read-only role agents (Read/Glob/Grep only)
skills/fusion-plan, fusion-review entry points (call the workflows by path)
workflows/*.js                    the orchestration (bundled; called via ${CLAUDE_PLUGIN_ROOT})
```

Workflows aren't an auto-loaded plugin component, so the skills invoke them by
`scriptPath` under `${CLAUDE_PLUGIN_ROOT}` — they ship as bundled data, not as a
registered-by-name workflow.
