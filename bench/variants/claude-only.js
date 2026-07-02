export const meta = {
  name: 'bench-claude-only',
  description: 'H2 ablation: the council MINUS the GPT-5.5 seat. Deterministically nests the real shipped fusion-review with seats=[skeptic,test,maintainer], so council and claude-only differ by exactly one seat through the same code path.',
  phases: [{ title: 'Review' }],
}

// Nest the REAL installed fusion-review workflow with the GPT seat dropped. seats is passed IN CODE (not via
// the outer -p agent, which was observed dropping args and letting GPT run) so the ablation is deterministic.
// SET THIS to your installed plugin's fusion-review.js (absolute path). Find it with:
//   find "$HOME/.claude/plugins/cache" -path '*fusion-council*/workflows/fusion-review.js'
const REVIEW = '/ABSOLUTE/PATH/TO/fusion-council/workflows/fusion-review.js'

phase('Review')
const r = await workflow({ scriptPath: REVIEW }, { seats: ['skeptic', 'test', 'maintainer'] })
return r
