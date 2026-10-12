# Fusion Council

![Fusion Council hero illustration showing multiple read-only review perspectives converging into a synthesized report](assets/fusion-council-hero.png)

Two deterministic, read-only **councils** for Claude Code that vet your work with
more than one model family before you commit to it:

- **`/fusion-council:fusion-plan <task>`** — before a non-trivial change. A Claude
  role panel (architect · skeptic · test-strategist · maintainer) plus **GPT Sol**
  deliberate in parallel; one merged judge+synthesize call compares them on merit and
  writes the plan from its own verdict. Since v0.4.0 this is the same one-call shape
  `fusion-review` has run since v0.3.0, ported on that arm's bench result — the plan
  council itself is unbenched (`EVAL.md` §B0); `args: { splitSynth: true }` restores
  the two-call pipeline.
- **`/fusion-council:fusion-review`** — after the change. One generalist Claude seat
  plus **GPT Sol** review your current `git diff`, judged and synthesized → one
  findings report. This duo is the bench-validated default (matched recall on the
  settled case set — n=1 hard case, so recall deltas are anecdote — at ~half the
  clean-diff noise and −21% cost; `EVAL.md` §B5′); pass
  `args: { roles: true }` to restore the role panel (skeptic · test-strategist ·
  maintainer + GPT Sol). Since v0.3.0 the judge and the report writer are **one
  call**: the same seat that grounds and gates the panel's claims writes the final
  report from its own verdict, which removes the judge→synthesizer handoff both
  measured information-loss bugs lived in. A same-era bench pass tied recall (5/5
  bug cases incl. the hard one), lowered clean-diff noise on every clean case, and
  cost −7% (`EVAL.md` §B0); `args: { splitSynth: true }` restores the two-call
  pipeline.

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

## The GPT Sol seat (optional)

The non-Claude panel seat shells out to the local **Codex CLI** (`codex exec`,
ChatGPT subscription — no metered API). If `codex` isn't installed — or a run fails
or times out — that seat drops out and the council runs Claude-only; every report's
**Council Coverage** line says so, so reduced diversity is never silent. Install
Codex CLI to enable it. It runs the newest `gpt-*-sol` in Codex's model list
(`~/.codex/models_cache.json`, resolved per run, falling back to `gpt-6.1-sol`;
`args.codexModel` pins one). The seat hands its prompt to `codex exec` on **stdin**
(the `-` / piped form, so large tasks/diffs aren't capped by `ARG_MAX`), which
needs a Codex CLI recent enough to support it (verified on v0.142.0); an older
CLI just shows up as UNAVAILABLE in Council Coverage.

## Telemetry & self-evaluation

The council writes nothing. Claude Code journals every Workflow run at
`~/.claude/projects/<project>/<session>/workflows/wf_*.json` — the returned `judge`,
`panel`, `coverage` and `stats` (arm, per-seat claim counts, GPT ran/retried) plus
what the plugin itself could never record: wall time, total tokens, per-seat model and
tokens, and killed/failed status. `eval/analyze.sh` reads those journals and prints
the scoreboard (`--bench` includes scratch-repo bench runs; `eval/journal.sh` looks a
run up by cwd or runId). Until 0.4.0 a sonnet seat appended a subset of this to
`~/.fusion-council/telemetry.jsonl` through a heredoc relay; that seat cost ~33k
tokens and ~40s per run and was removed in 0.5.0 (`args.noTelemetry` is now a no-op).
The full validation methodology (verified literature, seeded-bug benchmark design,
ablation arms `noGpt`/`roles`, kill metrics, and the §B5′ re-validation that made duo
the review default) lives in `EVAL.md`.

## Layout

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   one-plugin marketplace (this repo)
agents/                           5 read-only role agents (Read/Glob/Grep only)
skills/fusion-plan, fusion-review entry points (call the workflows by path)
workflows/*.js                    the orchestration (bundled; called via ${CLAUDE_PLUGIN_ROOT})
EVAL.md, eval/                    validation methodology + journal scoreboard scripts
```

Current Claude Code registers plugin workflows by name: real sessions launch
`Workflow({ name: "fusion-council:fusion-review" })` and the skill text shown to the
model is the workflow's own `meta`, not `skills/*/SKILL.md`. The `skills/` entries stay
as the documented contract and as the `scriptPath` fallback for older harnesses.
