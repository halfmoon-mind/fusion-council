export const meta = {
  name: 'bench-grade-recall',
  description: 'Grade ONE review against MANY injected bugs — per-bug detection (recall over K), quote-required.',
  phases: [{ title: 'Grade' }],
}

let a = args || {}
if (typeof a === 'string') {
  try {
    a = JSON.parse(a)
  } catch (e) {
    a = {}
  }
}

const SCHEMA = {
  type: 'object',
  required: ['perBug'],
  additionalProperties: false,
  properties: {
    perBug: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'detected', 'matched_quote'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          detected: { type: 'boolean' },
          matched_quote: { type: 'string' }, // verbatim span from the review, '' if not detected
        },
      },
    },
  },
}

// One agent per variant reads the review + the mutation records, and judges each injected bug independently.
phase('Grade')
const results = await parallel(
  (a.variants || []).map((v) => () =>
    agent(
      `You are a STRICT, quote-required grader. A reviewer reviewed ONE large multi-file diff that had ` +
        `MULTIPLE subtle bugs injected. Judge, for EACH injected bug independently, whether the review ` +
        `caught it.\n\n` +
        `STEP 1 — use your Read tool to read:\n` +
        `  - the reviewer output: ${v.reviewPath}\n` +
        (a.mutFiles || []).map((f) => `  - mutation records: ${f}`).join('\n') +
        `\nEach mutation record has {id, find, replace, correct_behavior, class}. The bugs to grade are ids: ` +
        `${JSON.stringify(a.ids)}.\n\n` +
        `For EACH id, set detected=true ONLY if the review contains a verbatim span (matched_quote) that ` +
        `names the right file/location AND describes THAT specific injected defect (per its correct_behavior) ` +
        `— not a vague/adjacent note or a different issue. Be conservative: generic commentary near the line ` +
        `is NOT detection. Return one entry per id in perBug.`,
      { schema: SCHEMA, model: 'opus', phase: 'Grade', label: `recall:${v.variant}` }
    ).then((r) => ({ variant: v.variant, ...r }))
  )
)
return { results }
