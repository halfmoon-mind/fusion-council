export const meta = {
  name: 'bench-propose-mutations',
  description: 'Propose subtle, lens-orthogonal, single-edit synthetic bugs in a real source file (guaranteed ground truth).',
  phases: [{ title: 'Propose' }],
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
  required: ['mutations'],
  additionalProperties: false,
  properties: {
    mutations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'find', 'replace', 'class', 'lens', 'correct_behavior', 'difficulty'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' }, // short slug
          find: { type: 'string' }, // verbatim snippet, appears EXACTLY ONCE in the file
          replace: { type: 'string' }, // the buggy version (same span, minimally changed)
          class: { type: 'string' }, // off-by-one, wrong-operator, inverted-condition, dropped-await, null-deref, wrong-variable, sign-flip, wrong-boundary, swapped-args, missing-return, ...
          lens: { type: 'string', enum: ['orthogonal', 'aligned'] }, // does a reviewer checklist explicitly name this class?
          correct_behavior: { type: 'string' }, // what the ORIGINAL code does that the mutation breaks (the ground truth)
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        },
      },
    },
  },
}

phase('Propose')
const r = await agent(
  `Read the TypeScript file at ${a.filePath} with your Read tool. Propose ${a.n || 6} SUBTLE, LOCALIZED, ` +
    `single-edit bugs a developer could plausibly introduce.\n\n` +
    `Requirements per mutation:\n` +
    `- "find" is a snippet copied VERBATIM from the file that appears EXACTLY ONCE (unique anchor). Keep it ` +
    `short but unique (include enough surrounding chars to be unique).\n` +
    `- "replace" is the same span minimally changed to introduce a REAL behavioral bug (not a stylistic or ` +
    `type-only change; it must compile).\n` +
    `- Prefer LENS-ORTHOGONAL classes a code-review checklist does NOT explicitly name: off-by-one, wrong ` +
    `comparison operator (< vs <=, > vs >=), inverted boolean/condition, dropped await / missing async, ` +
    `null/undefined deref, wrong variable referenced, sign flip, wrong boundary/index, swapped arguments, ` +
    `missing return. Mark lens="aligned" only if a reviewer would obviously list this class (e.g. a swallowed ` +
    `error / fail-open); otherwise "orthogonal".\n` +
    `- Make them NON-OBVIOUS from the diff alone: the reviewer must understand the surrounding logic to see ` +
    `the bug. Avoid changes that are trivially wrong on sight.\n` +
    `- "correct_behavior" states precisely what the ORIGINAL code does that your replace breaks — this is the ` +
    `grading ground truth.\n` +
    `- Spread difficulty across easy/medium/hard.\n\n` +
    `Double-check each "find" occurs exactly once in the file before returning.`,
  { schema: SCHEMA, model: 'opus', phase: 'Propose', label: `propose:${a.id || 'file'}` }
)
return { filePath: a.filePath, ...r }
