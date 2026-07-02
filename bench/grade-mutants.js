export const meta = {
  name: 'bench-grade-mutants',
  description: 'Blind quote-required grading of reviewer outputs against injected synthetic-mutation ground truth.',
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
  required: ['detected', 'file_match', 'localization', 'matched_quote', 'severity_flagged', 'consumers_traced', 'depth_score', 'spurious_high_sev', 'rationale'],
  additionalProperties: false,
  properties: {
    detected: { type: 'boolean' },
    file_match: { type: 'boolean' },
    localization: { type: 'boolean' },
    matched_quote: { type: 'string' },
    severity_flagged: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    consumers_traced: { type: 'boolean' },
    depth_score: { type: 'integer' }, // 0=miss,1=file/area only or wrong-severity/hedged,2=+mechanism,3=+downstream
    spurious_high_sev: { type: 'integer' },
    rationale: { type: 'string' },
  },
}

phase('Grade')
const grades = await parallel(
  (a.items || []).map((it) => () =>
    agent(
      `You are a STRICT, quote-required grader for a code-review benchmark. The reviewer saw ONLY a buggy ` +
        `diff (blind to the fix). A single subtle bug was INJECTED into real code.\n\n` +
        `STEP 1 — use your Read tool to read THREE files:\n` +
        `  - mutation records: ${it.mutFile} — a JSON with a .mutations[] array. Find the entry whose "id" == ` +
        `"${it.id}". Its "correct_behavior" is the GROUND-TRUTH (what the original code did that the injected ` +
        `bug breaks) and "class" is the bug type.\n` +
        `  - reviewer output: ${it.reviewPath}\n` +
        `  - the fix (reverse of the injected bug = the correct code; the reviewer never saw it): ${it.fixPath}\n\n` +
        `EXPECTED FILE: ${it.target}\n\n` +
        `SCORING (based on the correct_behavior you read):\n` +
        `- detected=true ONLY if the review has a verbatim span (matched_quote) that BOTH names the correct ` +
        `file and describes THIS injected defect (its actual wrong behavior) — not a vague/adjacent note or a ` +
        `different issue that happens to touch the area.\n` +
        `- file_match / localization: right file / right behavior.\n` +
        `- severity_flagged: highest severity the review gave THIS bug (none if not detected).\n` +
        `- consumers_traced: named a concrete downstream consumer/blast-radius (not "some caller might").\n` +
        `- depth_score: 0=missed; 1=named file/area but vague/wrong-severity/hedged; 2=correct mechanism & ` +
        `appropriate severity; 3=also concrete downstream impact.\n` +
        `- spurious_high_sev: High/Critical findings NOT about this injected bug.\n` +
        `- Conservative: if the review never actually pinpoints THIS defect (only generic comments on the ` +
        `area), detected=false, depth_score=0.`,
      { schema: SCHEMA, model: 'opus', phase: 'Grade', label: `grade:${it.id}:${it.variant}` }
    ).then((g) => ({ id: it.id, variant: it.variant, ...g }))
  )
)
return { grades }
