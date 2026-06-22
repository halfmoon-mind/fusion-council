---
name: fusion-review
description: Run the deterministic multi-model review council (Claude role panel + GPT-5.5) over the current working-tree diff after implementation.
disable-model-invocation: true
---

# Fusion Review

Entry point for the review council. The orchestration lives in the bundled
workflow `workflows/fusion-review.js`; it reviews the current `git diff`.

1. Call the workflow by path (it takes no task — it reads the diff itself;
   `${CLAUDE_PLUGIN_ROOT}` resolves to this plugin's install directory):
   `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/fusion-review.js" })`
2. When it returns, show the returned `review` to the user as-is, and surface `coverage`.
   If there is no diff, it returns early — relay that and stop.
3. Do NOT edit files. The user decides what to act on.
