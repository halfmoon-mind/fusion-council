export const meta = {
  name: 'bench-grade',
  description: 'Blind, quote-required grading of reviewer outputs against a case ground truth (parallel over variants).',
  phases: [{ title: 'Grade' }],
}

// args: { caseId, bug, files, expected_severity, fixPath, variants: [{ variant, reviewPath }] }
// Robust to the host delivering args as a JSON string rather than a parsed object.
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
  required: [
    'detected',
    'file_match',
    'localization',
    'matched_quote',
    'severity_flagged',
    'severity_appropriate',
    'consumers_traced',
    'depth_score',
    'spurious_high_sev',
    'rationale',
  ],
  additionalProperties: false,
  properties: {
    detected: { type: 'boolean' }, // a finding corresponds to THE ground-truth bug
    file_match: { type: 'boolean' }, // that finding names the correct file
    localization: { type: 'boolean' }, // it points at the right behavior/location, not just the file
    matched_quote: { type: 'string' }, // verbatim span from the review that constitutes detection ('' if none)
    severity_flagged: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    severity_appropriate: { type: 'boolean' }, // severity roughly matches the expected impact
    consumers_traced: { type: 'boolean' }, // review traced the concrete downstream/blast-radius impact
    depth_score: { type: 'integer' }, // 0=miss, 1=file/area only, 2=correct mechanism+appropriate severity, 3=+downstream blast radius
    spurious_high_sev: { type: 'integer' }, // High/Critical findings NOT about the bug (false-positive proxy)
    rationale: { type: 'string' },
  },
}

phase('Grade')
const grades = await parallel(
  (a.variants || []).map((v) => () =>
    agent(
      `You are a STRICT, quote-required grader for a code-review benchmark. The reviewer saw ONLY a buggy ` +
        `diff (blind to the fix). Grade how well it caught the real bug.\n\n` +
        `STEP 1 — use your Read tool to read BOTH files:\n` +
        `  - reviewer output: ${v.reviewPath}\n` +
        `  - ground-truth fix (the patch that restores correctness; the reviewer never saw it): ${a.fixPath}\n\n` +
        `GROUND-TRUTH BUG: ${a.bug}\n` +
        `EXPECTED FILE(S): ${JSON.stringify(a.files)}\n` +
        `EXPECTED SEVERITY (impact of the bug): ${a.expected_severity || 'unknown'}\n\n` +
        `SCORING:\n` +
        `- detected=true ONLY if the review contains a verbatim span (matched_quote) that BOTH (a) names the ` +
        `correct file and (b) describes the actual defect above — not a vague/adjacent mention.\n` +
        `- file_match / localization: whether that span names the right file / points at the right behavior.\n` +
        `- severity_flagged: the highest severity the review assigned to THIS bug's finding (none if not detected).\n` +
        `- severity_appropriate: true if that severity roughly matches EXPECTED SEVERITY (don't over-credit a ` +
        `hedged "maybe fine" as appropriate for a high-impact bug).\n` +
        `- consumers_traced: true if the review identifies the concrete downstream consumer(s)/blast-radius ` +
        `actually affected (not just "some consumer might depend on this").\n` +
        `- depth_score: 0=missed; 1=named the file/area but vague, wrong severity, or hedged to "no change ` +
        `needed"; 2=correct mechanism AND appropriate severity; 3=also traced the concrete downstream impact.\n` +
        `- spurious_high_sev: count High/Critical findings NOT about this bug (false-positive proxy).\n` +
        `- Be conservative and consistent: if the match is uncertain or merely topical, detected=false.`,
      { schema: SCHEMA, model: 'opus', phase: 'Grade', label: `grade:${v.variant}` }
    ).then((g) => ({ variant: v.variant, ...g }))
  )
)
return { caseId: a.caseId, grades }
