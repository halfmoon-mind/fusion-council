---
name: fusion-review
description: Run the deterministic multi-model review council (generalist Claude seat + GPT-5.6 Sol; args.roles restores the Claude role panel) over the current working-tree diff after implementation.
disable-model-invocation: true
---

# Fusion Review

Entry point for the review council. The orchestration lives in the bundled
workflow `workflows/fusion-review.js`; it reviews the current `git diff`.

1. Call the workflow by path (it takes no task — it reads the diff itself;
   `${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's install directory):
   `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/fusion-review.js" })`
   The default panel is the bench-validated duo (one generalist Claude seat +
   GPT-5.6 Sol), and since v0.3.0 the judge and report writer are one merged call.
   Only if the user explicitly asks, pass `args: { roles: true }` for the full role
   panel (skeptic · test-strategist · maintainer + GPT-5.6 Sol) or
   `args: { splitSynth: true }` for the two-call judge→synthesize pipeline.
2. When it returns, show the returned `review` to the user as-is, and surface `coverage`.
   If there is no diff, it returns early — relay that and stop. If the capture step itself fails
   (it yields neither a diff nor a clean `NO_DIFF` signal), the workflow throws instead of silently
   skipping a dirty tree — surface the error rather than treating it as "no diff".
3. Do NOT edit files. The user decides what to act on.
