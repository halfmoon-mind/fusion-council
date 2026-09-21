#!/usr/bin/env node
// Offline smoke for workflows/fusion-plan.js: stub the workflow globals, run BOTH pipeline branches
// (merged default + splitSynth), assert their call shapes. No subagents, no cost — same guard
// smoke_review.mjs gives the review council. Run: node eval/smoke_plan.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../workflows/fusion-plan.js'),
  'utf8'
).replace(/^export const meta/m, 'const meta')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function run(args) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, schema: !!opts.schema })
    if (opts.label === 'context:repo') return 'repo map stub'
    if (opts.label === 'context:session') return 'NONE'
    if (opts.label && opts.label.startsWith('panel:gpt-')) return 'gpt point: a.js:1 — x'
    if (opts.label && opts.label.startsWith('panel:')) return 'claude point: a.js:1 — x'
    if (opts.schema) {
      const out = {}
      for (const k of opts.schema.required) out[k] = k === 'plan' ? '# Fusion Plan (merged stub)' : []
      return out
    }
    if (opts.label === 'synthesize') return '# Fusion Plan (split stub)'
    throw new Error('unexpected agent call: ' + opts.label)
  }
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const body = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', src)
  return { calls, result: await body(agent, parallel, () => {}, () => {}, args) }
}

{
  const { calls, result } = await run({ task: 'do a thing' })
  const labels = calls.map((c) => c.label)
  assert(labels.includes('judge+synthesize'), 'default: judge+synthesize seat ran')
  assert(!labels.includes('judge') && !labels.includes('synthesize'), 'default: split seats did not run')
  assert.equal(result.plan, '# Fusion Plan (merged stub)', 'default: plan comes from the plan field')
  assert(!('plan' in result.judge), 'default: plan stripped from the judge object (journal shape)')
  assert.equal(result.stats.arm, 'full-merged', 'default: stats.arm records the actual configuration')
  assert.equal(result.stats.seats.length, 5, 'default: stats.seats lists every panelist that answered')
}
{
  const { calls, result } = await run({ task: 'do a thing', splitSynth: true })
  const labels = calls.map((c) => c.label)
  assert(labels.includes('judge') && labels.includes('synthesize'), 'split: both seats ran')
  assert(!labels.includes('judge+synthesize'), 'split: merged seat did not run')
  assert.equal(result.plan, '# Fusion Plan (split stub)', 'split: plan comes from the synthesize seat')
}
{
  // args.task is mandatory and the string-args normalization must still reach it
  const { result } = await run('{"task":"json-encoded args"}')
  assert.equal(result.plan, '# Fusion Plan (merged stub)', 'string args: JSON-encoded args normalized')
  await assert.rejects(() => run({}), /missing args.task/, 'missing task throws')
}
console.log('smoke_plan OK')
