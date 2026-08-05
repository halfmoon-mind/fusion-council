#!/usr/bin/env node
// Offline smoke for workflows/fusion-review.js: stub the workflow globals, run BOTH pipeline branches
// (split default + mergedSynth), assert their call shapes. No subagents, no cost — the cheap guard the
// bench lacked (a branch typo used to surface only mid-bench, ~$2/attempt). cf. EVAL.md §B0.
// Run: node eval/smoke_review.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../workflows/fusion-review.js'),
  'utf8'
).replace(/^export const meta/m, 'const meta')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function run(args) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, schema: !!opts.schema })
    if (opts.label === 'capture:diff')
      return '===FUSION_DIFF_PATH===/tmp/fake-diff\n M a.js\n---DIFF---\ndiff --git a/a.js b/a.js\n+x'
    if (opts.label && opts.label.startsWith('panel:gpt-')) return 'gpt finding: a.js:1 — x'
    if (opts.label === 'panel:claude-generalist') return 'claude finding: a.js:1 — x'
    if (opts.schema) {
      const out = {}
      for (const k of opts.schema.required) out[k] = k === 'report' ? '# Fusion Review (merged stub)' : []
      return out
    }
    if (opts.label === 'synthesize') return '# Fusion Review (split stub)'
    throw new Error('unexpected agent call: ' + opts.label)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const body = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', src)
  return { calls, result: await body(agent, parallel, () => {}, () => {}, args) }
}

const expectMerged = async (args, tag) => {
  const { calls, result } = await run(args)
  const labels = calls.map((c) => c.label)
  assert(labels.includes('judge+synthesize'), `${tag}: judge+synthesize seat ran`)
  assert(!labels.includes('judge') && !labels.includes('synthesize'), `${tag}: split seats did not run`)
  assert.equal(result.review, '# Fusion Review (merged stub)', `${tag}: review comes from the report field`)
  assert(!('report' in result.judge), `${tag}: report stripped from the judge object (telemetry shape)`)
}
await expectMerged({ noTelemetry: true }, 'default')                      // merged IS the default (0.3.0)
await expectMerged({ mergedSynth: true, noTelemetry: true }, 'legacy')    // legacy flag accepted as no-op
{
  const { calls, result } = await run({ splitSynth: true, noTelemetry: true })
  const labels = calls.map((c) => c.label)
  assert(labels.includes('judge') && labels.includes('synthesize'), 'split: both seats ran')
  assert(!labels.includes('judge+synthesize'), 'split: merged seat did not run')
  assert.equal(result.review, '# Fusion Review (split stub)', 'split: review comes from the synthesize seat')
}
console.log('smoke_review OK')
