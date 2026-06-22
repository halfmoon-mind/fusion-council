---
name: fusion-plan
description: Run the deterministic multi-model planning council (Claude role panel + GPT-5.5) before a non-trivial change, then implement only after the user approves.
disable-model-invocation: true
---

# Fusion Plan

Entry point for the planning council. The orchestration lives in the bundled
workflow `workflows/fusion-plan.js`; it always runs the full pipeline (no skip gate).

1. Call the workflow by path with the user's request (`${CLAUDE_PLUGIN_ROOT}` resolves
   to this plugin's install directory):
   `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/fusion-plan.js", args: { task: "$ARGUMENTS" } })`
2. When it returns, show the returned `plan` to the user as-is. Surface `coverage`
   (especially if GPT-5.5 was unavailable, so the user knows diversity was reduced).
3. Do NOT implement until the user explicitly approves. Only the main session edits files.
