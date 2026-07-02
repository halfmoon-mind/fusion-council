# bench — an empirical review benchmark for fusion-council

fusion-council ships a *design rationale* for its multi-model council but no *measurements*. This harness
replaces "good by design" with "measured": does the council actually catch more real bugs than a single
strong model, does the cross-family GPT-5.5 seat add anything, and at what cost?

> **Status: preliminary.** Sample sizes are small (≈10–20 cases per regime), so results are **directional,
> not statistically significant**. The harness is built so you can grow the dataset on your own repo.

## What it tests

- **H1 — council vs single strong model:** does the full council (Claude role panel + GPT-5.5 + judge +
  synth) detect more/deeper than one Opus reviewing the same diff?
- **H2 — the GPT-5.5 seat's value:** does dropping only the GPT seat (`claude-only`) change anything?
- **Precision:** false-positive (spurious High/Critical) rate on correct changes.

## Method (and its honesty controls)

- **Cases** come from two sources: (1) *organic* — real single-purpose bug-fix commits from a private
  TypeScript monorepo, reconstructed as the bug via `git apply -R` (reverted-fix); (2) *synthetic* — subtle,
  lens-orthogonal single-edit bugs (off-by-one, wrong operator, inverted condition, dropped await, wrong
  variable, sign flip, …) injected into real code by `dataset/build/propose-mutations.js` (ground truth is
  known because we inject it).
- **Leak-free reconstruction** (`lib/apply-case.sh`, `dataset/build/apply-*.sh`): each case is a *fresh* git
  repo with a single neutral `baseline` commit and the bug left as an **uncommitted diff**, so the reviewer
  can't read the fix from history. (Necessary: with the fix commit present, reviewers quoted its message and
  named it "a revert of <sha>" — a direct answer leak.)
- **Real shipped path:** every variant runs the *actual* `fusion-review` workflow headless (`claude -p`) with
  the case repo as cwd (`driver/run_case.sh`), so capture, role seats, judge, and the codex/GPT seat all run
  exactly as in production. Ablations use a `seats` param baked in via code, not model-forwarded args.
- **Blind, quote-required grading** (`grade*.js`): the grader sees the ground truth (the reviewer never
  does) and only counts a detection if the review contains a verbatim span naming the right file **and**
  describing the actual defect. `depth_score` (0–3) captures mechanism + severity + blast-radius tracing.
- **Cross-family grader check** (`grade-recall-gpt.sh`): the same verdicts, re-graded by GPT-5.5 via the
  Codex CLI, agreed with the Opus grader **12/12** on the large-diff cases (including a case where the two
  reviewers had *complementary* misses) — so the recall verdicts are not an Opus self-preference artifact.

## Results so far (directional)

**Focused diffs (small diffs, or many bugs in a tiny diff) — 14 cases:**
- **Detection: no council advantage.** A single Opus detected every bug the council did (incl. a 12-bug diff:
  all variants 12/12). On a focused diff a strong model scrutinizes every changed line regardless of bug
  subtlety.
- **Depth:** council ≈ +0.75 `depth_score` over single-opus (blast-radius tracing + severity calibration on
  *ambiguous* changes); on unambiguous bugs the gap ≈ 0.
- **GPT-5.5 seat: 0 measurable benefit** (`council` == `claude-only` throughout).

**Large diffs (a bug buried in ~750–1400 lines of legitimate change) — 5 cases, 10 needles:**

| variant | recall | notes |
|---|:---:|---|
| council | **8/10 (80%)** | ≥ single-opus on every case; strictly better on 2/5 |
| single-opus | 6/10 (60%) | never beat council; terser reviews miss more in big diffs |

- The council's edge here is **modest but consistent** (never worse; catches a hard needle single-opus
  misses ~40% of the time) and held on both server and frontend code.
- **GPT-5.5 seat: still 0** — the panel gain comes from the multiple Claude *role* seats, not the
  cross-family seat.

**Bottom line:** on small/focused diffs a single Opus is equivalent at ~1/5 the cost; the council earns its
keep on large/complex diffs (fewer misses + blast-radius depth); the GPT-5.5 seat is not justified by any
measurement here.

## Layout

```
lib/apply-case.sh                 reverted-fix case → leak-free repo (bug uncommitted)
dataset/build/
  propose-mutations.js            LLM proposes subtle lens-orthogonal single-edit bugs in a file
  apply-mutant.sh                 one synthetic mutation → leak-free case
  apply-multi.sh                  many mutations into one baseline (multi-bug diff)
  apply-a2.sh                     bury mutations inside a real large feature diff (addition-framed)
driver/
  run_case.sh                     run ONE variant over a case (headless claude -p, structured capture)
  run_matrix.sh / run_mutants.sh  batch examples (edit the job list for your repo)
variants/
  single-opus.js                  H1 baseline: one Opus reviewing the diff (reuses REVIEW_FRAMING)
  claude-only.js                  H2 ablation: council minus the GPT seat (set REVIEW to your install)
grade.js / grade-mutants.js       blind quote-required grading (per case / per mutation)
grade-recall.js                   recall over K bugs in one review
grade-recall-gpt.sh               cross-family (GPT-5.5) grader for validating the above
```

The case **datasets are gitignored** — they are derived from a private repo. Generate your own from your
repo's fix history (`lib/apply-case.sh`) and/or by injecting mutations (`dataset/build/propose-mutations.js`).

## Caveats

- Small n — directional only; grow the dataset for significance.
- Reverted-fix cases are an **optimistic upper bound** (a removal diff shows the correct code being deleted).
- The headless driver returned early on a ~6.7k-line diff (nested workflow outlived the `-p` session) — a
  driver ceiling, not a plugin bug; keep large-diff cases under a few thousand lines or lengthen the timeout.
- Cost ≈ $2/council run vs ≈ $0.45/single-opus run.
