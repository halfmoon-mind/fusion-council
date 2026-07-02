# Validating the Fusion Council

*How to know whether (1) the multi-model mix is justified, (2) fusion-review catches bugs without omissions, and (3) fusion-plan plans are actually good. Generated 2026-07-02 from a research + design + adversarial-attack workflow; observational numbers mined from 104 historical judge outputs.*

## 0) First-cut observational numbers (already measured, from 104 past runs)

Judge outputs across 104 historical fusion-plan/fusion-review runs (all versions mixed, incl. dev-test runs):

| Seat | surviving uniqueInsights | invalidClaims (dropped) |
|---|---|---|
| maintainer | ~175 | ~46 |
| skeptic | ~159 | ~73 |
| GPT-5.5 | ~136 | ~91 (highest) |
| test-strategist | ~120 | ~62 |
| architect (plan only) | ~54 | ~67 |

- GPT seat produced >=1 judge-credited unique insight in **73/104 runs (70%)**; 0 in 31 runs.
- GPT had >=1 invalid claim in 65/104 runs.
- **Caveats (structural, not dismissible):** the scorer is an Opus judge; in review mode the GPT seat sees only the diff text with no repo access, so the grounding gate hits it disproportionately by construction; "survived" = judge's opinion, not verified ground truth (circular). These numbers are descriptive evidence the seat pays rent — they are NOT a causal measurement and must never be a kill-metric input on their own.
- **Correction (2026-07-02, second adversarially-verified sweep):** the blanket "Claude judge self-preference" worry above is outdated — modern Claude judges measure *negative* self-preference (Sonnet-4.5 β=−0.229, arXiv:2604.22891) and ~90% of raw self-preference is quality confound (arXiv:2601.22548). The real judge tilts are similarity-affinity (Goel, ICML 2025), verbosity/position bias, and a structural one inside this pipeline: the judge's drop-ungroundable-SINGLE-SOURCE rule favored the correlated Opus majority (GPT's unique claims are single-source by construction; same-vendor frontier models agree on ~60% of joint errors, Kim et al. ICML 2025). **Fixed 2026-07-02**: both judge prompts now define corroboration as CROSS-FAMILY ONLY and tag `[cross-family]` consensus (measurable via `eval/analyze.sh`).

## 1) What the literature says (bottom lines)

### Multi-model ensemble validity

At a matched token budget, the published evidence does NOT show that mixing model families reliably beats a single strong model — the best budget-controlled comparisons (Self-MoA, Huang et al., Smit et al.) favor repeated sampling/self-consistency of the single strongest model whenever there is a clear quality leader, and the mixed-family MoA headline result was directly overturned by Self-MoA (+6.6 AlpacaEval by NOT mixing). Heterogeneity earns its cost only under specific conditions that the literature does measure: (1) member models near quality parity with complementary strengths (ReConcile: +10.0 pts for GPT-4 from debating Bard/Claude2; Heter-MAD: +6.4–8.2% over homogeneous debate), and (2) error decorrelation, which is real across families (same-developer models have measurably more correlated errors) but shrinking — frontier models now agree on ~60% of their joint errors, capping ensemble gains. For code review specifically, multi-model aggregation raises recall but collapses precision (union voting: recall 82.7 vs 81.3 but F1 61.4 vs 71.6), so net value hinges on the judge gate — and the judge is the weakest link: Claude-v1 showed the largest measured self-enhancement bias (+25% win rate for its own outputs vs +10% for GPT-4), judge affinity bias extends to merely similar models, and the mechanism (favoring low-perplexity/familiar text) means a Claude judge will systematically over-credit Claude panelists over a GPT seat unless the gate is family-blind. Unstructured heterogeneous teams are actively harmful (up to 37.6% below their own best member); judged-and-synthesized pipelines with a debiased, strict judge are the only configuration the evidence plausibly supports — and no paper yet directly validates that exact configuration for code review or implementation planning at matched budget.

> **Correction & extension (2026-07-02, second adversarially-verified sweep, 11 agents):** (a) The Claude-v1 +25% self-enhancement figure above is outdated — modern Claude judges measure *negative* self-preference (Sonnet-4.5 β=−0.229, arXiv:2604.22891) and ~90% of raw self-preference is quality confound (arXiv:2601.22548); the real judge threats are similarity-affinity, verbosity/position bias, and this pipeline's own single-source drop rule (fixed — see §0). (b) Every measured SE-ensemble win is **selection over complete candidates** (DEI 27.3→34.3%, CodeMonkeys 66.2 vs 62.8%, ByteDance TRAE SWE-bench SOTA); zero published wins for merge-style synthesis of free-text opinions. (c) Judge selection is the ensemble ceiling (Large Language Monkeys: answer coverage 82.9→98.4% while judge-picked accuracy stays 40.5→41.4%). (d) Persona/role prompts show replicated null accuracy effects (162-persona null, EMNLP 2024 + reproductions), and same-vendor frontier models agree on ~60% of joint errors (Kim et al., ICML 2025) → 4-Opus consensus is substantially pseudo-replication, not confirmation. Net: the comparator the council must beat is **duo = 1 Opus + 1 GPT + the same grounded judge** (~half cost), judged by downstream outcomes.

Key claims:

- **[strong]** SUPPORTS (weakly, not budget-matched): Multi-agent debate among 3 copies of ChatGPT (2 rounds) improved GSM8K 77.0->85.0, arithmetic 67.0->81.8, MMLU 63.9->71.1, biography factuality 66.0->73.8 over a single agent (Du et al. 2023). Caveats: homogeneous agents (same model), ~6-9x the calls of the baseline with no budget-matched control, and the cross-model (ChatGPT+Bard) result is an n=20 anecdote (11 and 14 solved alone -> 17 jointly).
  - source: https://arxiv.org/abs/2305.14325 ; https://composable-models.github.io/llm_debate/
- **[strong]** UNDERMINES (budget-matched): When the number of responses is equalized, multi-agent debate loses to plain self-consistency of one model: 6 responses -> debate 83.2% vs self-consistency 85.3%; 9 responses -> debate 83.0% vs 88.2% (GSM8K, GPT-3.5). The authors conclude debate gains are really a majority-voting/consistency effect, not correction through critique.
  - source: https://arxiv.org/abs/2310.01798
- **[strong]** UNDERMINES: Systematic benchmarking (ICML 2024) found multi-agent debate protocols 'do not reliably outperform' self-consistency and ensembling baselines even while consuming MORE inference compute; MAD is also hyperparameter-sensitive (agent-agreement tuning can recover and exceed baselines, but out-of-the-box it does not win).
  - source: https://arxiv.org/abs/2311.17371 ; https://proceedings.mlr.press/v235/smit24a.html
- **[strong]** UNDERMINES: A single agent with a strong prompt (including demonstrations) matches the best multi-agent discussion frameworks across a wide range of reasoning tasks and backbones; multi-agent discussion only wins when the prompt has no demonstrations (Wang et al., ACL 2024).
  - source: https://arxiv.org/abs/2402.18272 ; https://aclanthology.org/2024.acl-long.331/
- **[strong]** SUPPORTS (headline) then OVERTURNED (budget-matched): Mixture-of-Agents with only open-source models scored 65.1% on AlpacaEval 2.0 vs GPT-4o's 57.5% (Wang et al. 2024). But Li et al. 2025 showed 'Self-MoA' — spending the identical ensemble budget on repeated samples from the single best model — beats mixed-model MoA by +6.6% on AlpacaEval 2.0 and +3.8% average on MMLU/CRUX/MATH; mixing different LLMs usually lowers average output quality, and MoA is far more sensitive to member quality than to diversity. Mixing helped only when member models were close in quality with genuinely complementary strengths.
  - source: https://arxiv.org/abs/2406.04692 ; https://arxiv.org/abs/2502.00674
- **[strong]** UNDERMINES (more calls can hurt): For Vote/Filter-Vote compound systems, performance is non-monotonic in the number of LLM calls — it rises then FALLS, because more calls raise accuracy on easy queries but lower it on hard queries (majority converges on the systematic error). Throwing budget at more panel calls can degrade exactly the hard cases a review council exists for.
  - source: https://arxiv.org/abs/2403.02419
- **[strong]** SUPPORTS (same-model voting has real but bounded gains): Simple sampling-and-voting scales performance with ensemble size — Llama2-13B at ensemble size ~15 matched Llama2-70B on GSM8K (59% vs 54%), with larger relative gains on harder tasks — but gains plateau past a task-complexity threshold. This is the single-family baseline any heterogeneous council must beat at equal budget.
  - source: https://arxiv.org/abs/2402.05120
- **[strong]** SUPPORTS (cross-family, the strongest direct evidence): ReConcile (ACL 2024) — a round-table of ChatGPT + Bard + Claude2 with confidence-weighted voting — beat prior single- and multi-agent baselines by up to 11.4%, and adding GPT-4 as an agent improved GPT-4's own initial answers by +10.0 absolute points via feedback from WEAKER different-family agents. Note: reasoning QA benchmarks, not code review; not token-budget-normalized against GPT-4 self-consistency.
  - source: https://arxiv.org/abs/2309.13007 ; https://aclanthology.org/2024.acl-long.381/
- **[strong]** SUPPORTS (heterogeneity specifically, homogeneous MAD does not): 'Stop Overvaluing Multi-Agent Debate' (2025) replicated that 5 MAD methods across 9 benchmarks fail to reliably beat CoT/self-consistency — but injecting model heterogeneity (randomly mixing GPT-4o-mini and Llama-3.1-70B agents, p=0.5) consistently improved every MAD framework tested: Heter-SoM +6.4% and Heter-EoT +8.2% over the homogeneous averages (AgentVerse variant ranged -5.1% to +11.6%, avg +2.1%). i.e., IF you run a council at all, cross-family membership is the one intervention that reliably helped.
  - source: https://arxiv.org/abs/2502.08788
- **[strong]** SUPPORTS the decorrelation rationale, but with a hard ceiling: LLM errors are substantially correlated — on one leaderboard, when two models both err they agree on the SAME wrong answer 60% of the time (vs ~chance if independent); correlation is highest for models from the same developer/base architecture, and, critically, MORE accurate models have MORE correlated errors even across distinct providers (350+ LLMs, ICML 2025). So mixing families buys real decorrelation vs a same-family panel, but the independent-errors assumption behind ensemble math increasingly fails at the frontier.
  - source: https://arxiv.org/abs/2506.07962 ; https://proceedings.mlr.press/v267/kim25e.html
- **[strong]** UNDERMINES (and generalizes judge bias): 'Great Models Think Alike and this Undermines AI Oversight' (ICML 2025) introduces CAPA (chance-adjusted error-overlap similarity) and measures that (a) LLM-as-judge scores are biased TOWARD models functionally similar to the judge — generalizing self-preference to family/similarity affinity — and (b) model mistakes are becoming more similar as capabilities rise. Direct implication: a Claude judge over a mixed panel will systematically over-score the Claude seats relative to the GPT seat, and the diversity you paid for is shrinking over time.
  - source: https://arxiv.org/abs/2502.04313
- **[strong]** UNDERMINES (judge bias, measured): In the original LLM-as-judge study (Zheng et al., NeurIPS 2023), self-enhancement bias was measured directly: GPT-4 favors its own answers with ~10% higher win rate; Claude-v1 favors its own with ~25% higher win rate (GPT-3.5 showed no self-favoring). Panickssery et al. (NeurIPS 2024) showed the mechanism is causal — self-preference scales linearly with self-recognition ability (GPT-4 recognizes its own text at 73.5%; fine-tuning recognition to >90% strengthens self-preference). Wataoka et al. (2024) found judges over-score LOW-PERPLEXITY (familiar-style) outputs regardless of true authorship — so the bias hits same-family panelists, not just literal self-outputs.
  - source: https://arxiv.org/abs/2306.05685 ; https://arxiv.org/abs/2404.13076 ; https://arxiv.org/abs/2410.21819
- **[strong]** SUPPORTS (multi-agent judging, modestly): ChatEval (ICLR 2024) — multiple debating evaluator agents with DIVERSE role personas — improved evaluation accuracy on FairEval by +6.2% (ChatGPT) and +2.5% (GPT-4) over a single judge, and identical role prompts DEGRADED performance. Supports role-diverse panels for the judging step itself, though agents were same-model personas, not different families.
  - source: https://arxiv.org/abs/2308.07201 ; https://openreview.net/forum?id=FQepisCUWu
- **[moderate]** UNDERMINES (unstructured heterogeneous teams): 'Multi-Agent Teams Hold Experts Back' (2026) — self-organizing heterogeneous LLM teams with genuine differential expertise consistently FAILED to match their own best member, losing up to 37.6% (up to 41.1% on ML benchmarks), even when explicitly told who the expert was; teams converge by 'integrative compromise' rather than deferring to expertise, and it worsens with team size. This is the failure mode a structured judge/synthesis pipeline must be shown to avoid — consensus mechanisms can also filter OUT minority-correct answers.
  - source: https://arxiv.org/abs/2602.01011
- **[moderate]** MIXED (code review/vulnerability detection specifically): Multi-model aggregation trades precision for recall — a 4-agent ensemble with union voting hit 82.7% recall on PyVul, edging fine-tuned GPT-3.5's 81.3%, but precision fell to 48.8% vs 63.9% (F1 61.4 vs 71.6 — a net LOSS); separately, an empirical study ensembling five different code-LLM families (DeepSeek-Coder, CodeLlama, CodeQwen, StarCoder2) via bagging/boosting/stacking found all ensemble methods ranked above non-ensemble baselines on average. Net: for review tasks, heterogeneous panels find more true issues but flood false positives unless a strict judge gates them — the judge, not the panel, determines net value.
  - source: https://arxiv.org/abs/2509.12629 ; https://arxiv.org/pdf/2602.17875
- **[moderate]** SUPPORTS (rank-and-fuse architecture): LLM-Blender (ACL 2023) — the closest published analogue of a 'judged and synthesized' council — showed that because the best of 11 different open-source LLMs varies substantially per example, a pairwise RANKER plus a generative FUSER beats every individual member on MixInstruct. Caveats: all members were weak/near-parity models (no single dominant model, unlike frontier settings), and the ranker was a trained comparator, not a same-family LLM judge — so it sidesteps the self-preference problem a Claude judge reintroduces.
  - source: https://arxiv.org/abs/2306.02561 ; https://aclanthology.org/2023.acl-long.792/
- **[moderate]** GAP: No published study directly tests the exact configuration in question — a role-diverse same-family panel plus one other-family seat, LLM-judged and synthesized, for CODE REVIEW or IMPLEMENTATION PLANNING, controlled at equal total token budget against the single strongest model with self-consistency. All budget-matched negative results are on reasoning/QA benchmarks; all cross-family positive results (ReConcile, Heter-MAD) are not token-budget-normalized; the code-domain evidence is vulnerability detection with weaker models. Any claim that the council architecture 'works' or 'fails' for planning/review at matched budget is currently an extrapolation.
  - source: Survey of arXiv:2305.14325, 2310.01798, 2311.17371, 2402.18272, 2406.04692, 2502.00674, 2403.02419, 2402.05120, 2309.13007, 2502.08788, 2506.07962, 2502.04313, 2306.05685, 2404.13076, 2410.21819, 2308.07201, 2602.01011, 2509.12629, 2306.02561

### Measuring code-review recall/precision

Rigorous measurement of AI code-reviewer recall/precision has converged on three methodology families, each with a distinct ground-truth strategy: (1) seeded-defect injection (Qodo: LLM-injects 1-3 functional bugs + convention violations into real merged PRs, 100 PRs / 580 issues; a "hit" requires both correct problem description AND file+line localization); (2) curated real-bug retrospectives (Greptile/Augment: 50 bug-fix PRs replayed pre-fix; DeepSource: 165 real CVEs from the OpenSSF CVE Benchmark; CR-Bench: 174 SWE-bench-derived review scenarios; SWR-Bench: 1,000 PRs with reviewer-induced "change-points" as ground truth); and (3) behavior-based online metrics (Martian: precision = % of comments developers act on across ~300k PRs; Cursor Bugbot: "resolution rate" = LLM-judged-at-merge-time fix rate, 52%→70%; Anthropic: engineer dismissal rate <1% plus adversarial verification agents). State-of-the-art numbers cluster at F1 50-60% on vendor benchmarks but collapse to ~19% F1 on the strictest academic hit-based benchmark (SWR-Bench), and precision/recall trade off sharply (CR-Bench: raising recall 27%→33% via reflexion cut signal-to-noise from 5.1 to 2.0). The load-bearing pitfalls are: (a) the "recall of what universe?" problem — every gold set is incomplete, so measured "false positives" are often real bugs the benchmark missed (Martian and Augment both documented this), and perturbation-only benchmarks can measure recall but structurally cannot measure precision; (b) evaluator bias — every vendor wins its own benchmark (Greptile scored itself 82% recall; Augment's rerun on the same repos scored Greptile 45%); (c) training-data leakage — Defects4J has ~80% repository membership in TheStack with 5-gram reproduction of 82% vs 48% on fresh code, motivating post-cutoff datasets (GitBug-Java, ConDefects); (d) severity weighting is almost universally absent from aggregate metrics; and (e) sub-100-sample datasets make 20-point tool gaps statistically fragile. A credible in-house evaluation therefore needs: recent post-cutoff real bugs (not just synthetic injections), hit-matching that requires localization + explanation, human-validated LLM-judge matching (~90% agreement is achievable), separate tracking of "valid but off-target" comments vs noise, and an online behavioral metric (action/resolution rate) to catch what the offline gold set misses.

Key claims:

- **[strong]** Seeded-defect injection methodology (Qodo): best-practice violations and 1-3 functional bugs (logic errors, edge cases, race conditions, resource leaks) are LLM-injected into real merged PRs from production repos, with double verification plus manual addition of naturally occurring issues; a 'hit' requires both an accurate description of the problem and correct file+line localization; dataset is 100 PRs containing 580 issues; Qodo reports its own F1 at 60.1%, and notes precision is tunable via post-filtering while recall is fundamentally constrained by codebase understanding.
  - source: https://www.qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review/
- **[strong]** Curated real-bug retrospective methodology (Greptile): 50 real bug-fix PRs from 5 OSS repos (Sentry/Python, Cal.com/TS, Grafana/Go, Keycloak/Java, Discourse/Ruby), replayed on a pre-fix branch; a bug counts as caught only if the tool leaves a line-level comment identifying the faulty code and explaining impact (summary-only mentions excluded); catch rates: Greptile 82%, Cursor Bugbot 58%, Copilot 54%, CodeRabbit 44%, Graphite 6%. Each PR is reduced to a single known bug, and false positives do not affect the catch-rate score.
  - source: https://www.greptile.com/benchmarks
- **[strong]** Independent reruns contradict vendor self-scores, demonstrating evaluator bias: Augment Code re-benchmarked 7 tools on 50 PRs from the same 5 repos using a 'golden comments' set (issues a competent human reviewer should catch), classifying outputs as TP/FP/FN, and measured Greptile at 45% recall vs Greptile's self-reported 82%; Augment's full table: Augment P65/R55/F59, Cursor Bugbot P60/R41/F49, Greptile P45/R45/F45, Codex P68/R29/F41, CodeRabbit P36/R43/F39, Claude Code P23/R51/F31, Copilot P20/R34/F25. Augment had to expand the golden set because many PRs contained meaningful issues missing from it.
  - source: https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results and https://deepsource.com/blog/ai-code-review-benchmarks
- **[moderate]** Behavior-based online evaluation (Martian Code Review Bench): instead of labeled ground truth, precision is measured as the % of a tool's review comments that developers act on (lead to an actual code change), observed across ~300,000 PRs over 2 months; a parallel offline benchmark runs 10 tools on 50 PRs against a human-annotated gold set. CodeRabbit topped it with 49.2% precision, ~53.5% recall (highest of any tool), F1 51.2%. Martian acknowledged the offline gold set was incomplete — some 'false positives' were genuine issues the benchmark had overlooked — and deliberately runs both benchmarks because they disagree.
  - source: https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark (reporting Martian's independent benchmark)
- **[strong]** Cursor Bugbot's production methodology: primary metric is 'resolution rate' — an LLM classifies at PR-merge time whether each flagged bug was actually fixed by the author in the final code, validated by having PR authors spot-check classifications ('correctly classified nearly all'). Online production resolution rates are paired with offline 'BugBench', a curated set of real code diffs with human-annotated bugs. Across ~40 experiments (v1 July 2025 → v11 Jan 2026), resolution rate rose 52% → 70%+, bugs flagged per run 0.4 → 0.7, resolved bugs per PR ~0.2 → ~0.5; many changes unexpectedly regressed metrics. Resolution rate deliberately conflates detection quality with developer trust.
  - source: https://cursor.com/blog/building-bugbot
- **[strong]** Anthropic's Claude Code /code-review measures quality via (a) an architectural false-positive filter — parallel specialized agents propose findings, then a verification step attempts to disprove each before posting, ranking survivors by severity — and (b) an online dismissal-rate proxy for precision: engineers mark <1% of findings incorrect. Internal coverage stats: 84% of PRs >1,000 lines get findings (avg 7.5 issues), 31% of PRs <50 lines (avg 0.5); substantive review comment coverage rose 16% → 54% after deployment; reviews take ~20 minutes. No recall number against a labeled bug universe is published; dismissal rate under-counts false positives that engineers silently ignore.
  - source: https://claude.com/blog/code-review
- **[strong]** CVE-grounded evaluation (DeepSource on the OpenSSF CVE Benchmark): 165 real JS/TS vulnerabilities that shipped, got CVE IDs, and were patched — each with vulnerable (prePatch) and fixed (postPatch) states and CWE labels via the OSV API; a detection counts only if it matches the exact vulnerability on security impact + attack pattern + code location; judged by Claude Opus 4.5 with tool names blinded. Results: DeepSource F1 84.51 (P100/R73.2), Cursor Bugbot 80.45 (P74.2/R87.8), Devin 78.08, Codex 77.70, Greptile 68.61, Claude Code 62.40 (P90.7/R47.6), Semgrep 36.70, CodeRabbit 36.00 (P100/R21.95). Caveats: ≤1,000-line files only, binary scoring, judge bias, and the vendor again wins its own benchmark.
  - source: https://deepsource.com/benchmarks
- **[strong]** Strictest academic benchmark (SWR-Bench, arXiv 2509.01494): 1,000 manually verified PRs (500 with review issues, 500 clean) from 12 Python projects; ground truth is 'change-points' — places where human reviewer comments demonstrably led to code modification — in 11 categories, refined with the SZZ algorithm and 5 graduate-student annotators (≥2 per PR). Hit-based P/R/F1 computed by an LLM judge (Gemini-2.5-Flash) semantically matching predictions to change-points, with 89.2-94.9% human hit-agreement. Best tool scores only 19.38% overall F1; aggregating 10 independent reviews lifts recall 118.8% to 30.4% (F1 21.9%); cross-model detection overlap is tiny (36 shared detections), implying unstable detection. Authors conclude current automated code review is impractical for deployment.
  - source: https://arxiv.org/html/2509.01494v1
- **[strong]** SWE-bench-derived review benchmark (CR-Bench, arXiv 2603.11078): converts real GitHub issues+fixes into review scenarios by LLM-filtering for 'PREVENTABLE' bugs, mapping buggy lines to the original PR via git blame, yielding 174 verified / 584 total instances (django, sympy, scikit-learn) tagged with root cause, impact, and 3-level severity. Its evaluator three-way classifies each comment as Bug Hit / Valid Suggestion (sound but off-target) / Noise, yielding Recall, Precision, Usefulness Rate, and Signal-to-Noise Ratio. GPT-5.2 single-shot: 27.0% recall, 3.6% precision, SNR 5.11; Reflexion raises recall to 32.8% but drops SNR to 1.95 — quantifying the recall/noise trade-off. Severity tags exist but aggregate metrics are not severity-weighted.
  - source: https://arxiv.org/html/2603.11078v1
- **[moderate]** Mutation/perturbation-style evaluation measures recall well but structurally cannot measure precision: a perturbation benchmark for agentic review systems (arXiv 2606.19749) seeds flaws and scores detection, but explicitly cannot score precision because comments on unperturbed content may be real pre-existing issues or hallucinations, indistinguishable without expert annotation. Related mutation work supports realism of seeded faults: Meta's ACH generated 9,095 mutants across 10,795 Kotlin classes with an LLM equivalent-mutant detector at precision 0.79 / recall 0.47, and studies find LLM-generated mutants are behaviorally closer to real bugs (1.75x higher real-bug detection) than classical mutation operators — relevant when choosing how to seed defects for reviewer benchmarks.
  - source: https://arxiv.org/pdf/2606.19749 ; https://arxiv.org/pdf/2501.12862 ; https://arxiv.org/pdf/2406.09843
- **[strong]** Training-data leakage is a measured, not hypothetical, pitfall for classic bug datasets: ~80% of Defects4J repositories appear in TheStack pretraining corpus; Codegen-multi reproduces Defects4J code at 82% 5-gram accuracy vs 48% on fresh 2024 Java repos, with NLL 0.15 vs 0.85 (5.63x); GitBug-Java (199 bugs, Jan-Oct 2023) shows only 38.9% membership and was built specifically to mitigate leakage; ConDefects serves the same role for fault localization/repair. Related work reports large fractions of 'correct' LLM patches exactly matching Defects4J ground truth (~79-87% for GPT-3.5/CodeLlama-7b), so any reviewer benchmark built on old, popular OSS bugs risks measuring memorization rather than detection.
  - source: https://arxiv.org/html/2411.13323 ; https://arxiv.org/html/2402.02961
- **[strong]** The 'recall of what universe of bugs?' problem is the central unsolved measurement issue: every gold set is incomplete, corrupting both the recall denominator and the precision numerator. Documented instances: Martian found offline-benchmark 'false positives' that were genuine issues its gold set had missed; Augment found many benchmark PRs contained meaningful issues absent from the golden set and had to expand it; SWR-Bench mitigates by using only reviewer-comment-induced code changes (verifiable but under-counts what reviewers missed); CR-Bench mitigates with a 'Valid Suggestion' third category so off-gold-set true findings don't count as noise; DeepSource notes ground truth is only objective for security (CVE exists or not) while 'bug risk vs acceptable code' is inherently subjective.
  - source: Multiple: coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark, augmentcode.com blog, arxiv.org/html/2509.01494v1, arxiv.org/html/2603.11078v1, deepsource.com/blog/ai-code-review-benchmarks
- **[strong]** Vendor self-benchmarking and small samples systematically inflate results: DeepSource's meta-analysis observes 'each vendor runs their own benchmark, on their own dataset, and wins' (Qodo wins Qodo's, Greptile wins Greptile's, Augment wins Augment's, DeepSource wins DeepSource's, CodeRabbit tops the one independent benchmark it publicizes); datasets under 100 entries make 20+ point gaps swing on a handful of edge cases; and LLM-injected synthetic ground truth (Qodo) makes the ground truth itself model-generated, biased toward bug types LLMs naturally produce. There is still no shared SWE-bench-equivalent standard for code review; minimum credibility bar proposed: independent administration, published datasets, real (not synthetic) defects.
  - source: https://deepsource.com/blog/ai-code-review-benchmarks
- **[strong]** Severity weighting is almost universally absent from published aggregate metrics: CR-Bench tags Low/Medium/High severity at construction but reports unweighted recall/precision; the code-review benchmark survey (arXiv 2602.13377) finds no severity-weighted metrics across the datasets it catalogs; Anthropic ranks findings by severity in output but publishes unweighted rates; only DeepSource's CVE matching implicitly weights by requiring security-impact match. The survey also catalogs the field's evaluation taxonomy — classification metrics (P/R/F1 dominant), ranking metrics, text-generation metrics (BLEU-4 for comment generation), user studies (acceptance rate, review time), and a near-total absence of execution-based evaluation (build/test verification of findings) — and names contamination and subjective ground truth as core validity threats.
  - source: https://arxiv.org/html/2602.13377v1 ; https://arxiv.org/html/2603.11078v1

### Measuring plan quality

Plan quality without ground truth is measured by triangulating three imperfect signals, none sufficient alone. (1) Downstream-outcome evaluation is the strongest: execute the plan and measure resolve rate / test pass rate (SWE-bench-style plan-then-execute); large-scale trajectory studies show removing plans lowers agent success across models and plan reminders raise it, and PlanSearch/Plan-and-Act show better or more diverse plans causally improve code and web-agent success — but it is expensive and confounds plan quality with executor skill. (2) Blinded pairwise preference judging with a held-out judge is the cheap proxy: GPT-4-class judges reach ~80% agreement with humans, matching human-human agreement, but only if you control the documented biases — swap positions (position bias/inconsistency can hit 55-79% on long outputs), length-control the comparison (verbosity bias; LC-AlpacaEval's regression correction lifts Arena correlation 0.94→0.98), and use a judge from a different model family than the generators (self-preference bias plus shared-blind-spot contamination when judge and generator share a family). (3) Rubric/requirement-based grading (G-Eval, Prometheus, Agent-as-a-Judge) anchors the judge to explicit criteria — checkable requirements per plan step outperform holistic scores (Agent-as-a-Judge: 90% vs 70% alignment with human consensus) — though long-form judge benchmarks find rubrics help but don't fully fix reliability. Known long-form judge failure modes to design around: position inconsistency, verbosity reward, self-preference, being misled by superficial coverage and confident fluency (plausibility substitutes for factual verification without references), same-family blind spots, context-window overflow, and refusals. Practical recipe: cheap gate = blinded, position-swapped, length-controlled pairwise judging by a cross-family judge against a repo-grounded rubric; periodic calibration = execute a sample of plans and check the proxy's ranking against actual resolve/rework outcomes.

Key claims:

- **[strong]** Downstream-outcome evaluation of plans is directly practiced at scale: a study of 16,991 SWE-agent trajectories (SWE-bench Verified/Pro, 4 LLMs, 8 plan settings) found removing the plan decreased resolve rates across all models, and periodic plan reminders consistently improved success — establishing execute-and-measure as a viable plan-quality signal.
  - source: From Plan to Action: How Well Do Agents Follow the Plan? — https://arxiv.org/html/2604.12147v2
- **[strong]** Plan adherence can be quantified without ground truth via compliance metrics: Plan Phase Compliance, Plan Order Compliance (longest-increasing-subsequence over phases), and Plan Phase Fidelity, aggregated geometrically; plans correlate positively but imperfectly with task success — agents benefit from plans even when compliance is low, suggesting plans aid local reasoning.
  - source: From Plan to Action — https://arxiv.org/html/2604.12147v2
- **[moderate]** Published evidence that better plans measurably improve agent success: Plan-and-Act (ICML 2025) shows an explicit Planner trained on synthetic plan annotations achieves SOTA 57.58% on WebArena-Lite and 81.36% on WebVoyager, with dynamic replanning reported at +34 percentage points over ReAct.
  - source: Plan-and-Act: Improving Planning of Agents for Long-Horizon Tasks — https://arxiv.org/abs/2503.09572
- **[strong]** Plan quality/diversity causally moves code outcomes: PlanSearch (NeurIPS 2024) shows searching over natural-language plans lifts Claude 3.5 Sonnet from pass@200 of 60.6% (repeated sampling) to 77.0% on LiveCodeBench, and search gains are predictable as a direct function of diversity over generated plan ideas.
  - source: Planning In Natural Language Improves LLM Search For Code Generation — https://arxiv.org/abs/2409.03733
- **[strong]** Blinded pairwise preference judging with a strong held-out judge is a validated proxy for quality without ground truth: GPT-4-as-judge achieves over 80% agreement with human preferences — the same level as human-human agreement — but the canonical paper explicitly identifies position bias, verbosity bias, self-enhancement bias, and limited reasoning-grading ability as failure modes requiring mitigation (e.g., position swapping).
  - source: Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena — https://arxiv.org/abs/2306.05685
- **[moderate]** Position bias in pairwise judging is systematic and worst when candidates are close in quality: judges become more consistent and fair only as the quality gap between answers widens, so plan A/B comparisons between similar-quality plans are the least reliable case.
  - source: Judging the Judges: A Systematic Investigation of Position Bias — https://arxiv.org/html/2406.07791v5
- **[strong]** Self-preference bias is measurable and significant: GPT-4 as judge exhibits significant self-preference in pairwise evaluation (quantified with an algorithmic-fairness-based metric), which motivates using a judge from a different model family than the plan generators.
  - source: Self-Preference Bias in LLM-as-a-Judge — https://arxiv.org/abs/2410.21819
- **[strong]** Verbosity bias can be statistically corrected rather than just prompted away: Length-Controlled AlpacaEval uses a causal/regression adjustment ('what would the win rate be if all outputs had the baseline's length?'), making the metric robust to verbosity gaming and raising Spearman correlation with Chatbot Arena from 0.94 to 0.98.
  - source: Length-Controlled AlpacaEval — https://arxiv.org/abs/2404.04475
- **[strong]** Rubric-based grading is an established alternative to raw preference: G-Eval (CoT-generated evaluation steps with weighted scoring) and Prometheus (13B evaluator trained on 1K fine-grained rubrics + 100K GPT-4 feedback instances, matching GPT-4 evaluation when given rubric and reference) show explicit criteria make graders reproducible — but Prometheus's parity requires reference materials, which plans lack; the practical substitute is grounding rubric items in checkable task/repo facts.
  - source: Prometheus: Inducing Fine-grained Evaluation Capability in Language Models — https://arxiv.org/abs/2310.08491
- **[strong]** Requirement-level, step-aware evaluation beats holistic scoring for agentic/development artifacts: Agent-as-a-Judge (Meta, ICML 2025) evaluates against 365 hierarchical user requirements on the DevAI benchmark of 55 AI-development tasks and aligns with human-judge consensus at 90% vs 70% for plain LLM-as-a-Judge — the closest published analogue to grading an implementation plan requirement-by-requirement.
  - source: Agent-as-a-Judge: Evaluate Agents with Agents — https://arxiv.org/abs/2410.10934
- **[moderate]** For long-form outputs (the regime implementation plans live in), LLM judges have a documented failure-mode profile: misled by superficial coverage; factual verification without reference context defaults to 'sounds plausible' so confident fluent hallucinations score high; severe position inconsistency (78.7% for GPT-4o-mini on one subset, 55.6% for GPT-5.2 on another); same-family generator/judge pairs share blind spots; plus practical failures (context-window overflow when output+rubric+references combine, and safety-policy refusals). Rubrics and references help but are not sufficient for stability.
  - source: Benchmarking LLM-as-a-Judge for Long-Form Output Evaluation — https://arxiv.org/abs/2606.01629
- **[weak]** The classical-planning literature's answer (validate plans with formal checkers like VAL, or measure executability/goal-condition recall step-by-step in an environment) does not transfer to natural-language implementation plans, which is why the software-agent field converges on execution outcomes plus judged proxies; success-rate-only evaluation is also acknowledged as insufficient for expensive plans that warrant pre-execution vetting.
  - source: Hierarchical Planning with KG-RAG and Symbolic Verification — https://arxiv.org/pdf/2504.04578 (and survey context from search results)


## 2) Proposed eval harness (design)

Advisor is unavailable; proceeding with the design as drafted.

# Fusion Council — Minimal Eval Harness

Everything below is bash + JSONL + jq. One new directory (`/Users/sanghyeon/projects/fusion-plan/eval/`), one telemetry file (`~/.fusion-council/telemetry.jsonl`), and two small code changes to the workflows (a telemetry append + a `noGpt` ablation arg).

Cost frame used throughout: one council run ≈ 3–4 Opus role seats + Opus judge + Opus synth + sonnet/haiku plumbing ≈ **$1.5–4 in Claude tokens** (measure exactly via `total_cost_usd` in the pilot, don't trust this estimate). The GPT-5.5 seat is a ChatGPT subscription → **$0 marginal**, so "does GPT add value" is really "does it add signal", not "is it worth its cost".

---

## A) Observational telemetry (free; runs on real usage)

### A1. Where the append goes — IMPLEMENTED 2026-07-02 (fallback path)

The primary design (direct `node:fs` append from the script) is **dead**: a probe workflow confirmed the runtime blocks `import()` entirely, exposes no `process`, and statically rejects `new Date()`. So the shipped implementation is the fallback, now live in both workflows immediately before their final `return`:

- One **sonnet telemetry seat** (label `telemetry`, phase Synthesize) appends the row via a QUOTED heredoc + `cat >>` — the same verbatim-copy tier as the codex-prompt seats. One retry on a missing `TELEMETRY_OK` (the seat can spuriously bail like the codex wrapper).
- **The shell supplies `ts`, `cwd`, and `run_id`** (`date -u`, `$PWD`, `epoch-$$-$RANDOM`) — solving the no-Date-in-script problem and same-second join collisions.
- **`jq -e` validates the row BEFORE append** — this guards **well-formedness, not fidelity**: a copy that stays valid JSON but alters a value passes silently (the workflow journal keeps ground truth). A copy that FAILS validation appends a tiny fixed `{dropped:true, workflow, ts, cwd, run_id}` stub instead, so the large-run drop bias is measurable (`dropped_rows` in `analyze.sh`).
- **Bounded mkdir lock** around the append (`~/.fusion-council/.lock`, ≤5s wait then best-effort): bench arms run councils in parallel and a judge-sized line exceeds the atomic-append boundary.
- Wrapped in try/catch: telemetry can NEVER break or gate a run. No hard timeout is possible (the runtime has no timers) — a hung seat is bounded by the harness agent lifecycle.
- **`args.noTelemetry` disables it** (disclosed in both workflows' meta descriptions): this append is the ONE write the otherwise read-only workflows perform, into a single global file that holds `subject_head` (200 chars of task/diff) and judge text (500 chars/entry) across every repo — pass `noTelemetry:true` where that's not acceptable. The file grows unbounded (~5KB/run; prune manually if it ever matters).
- The row is **compact** — judge entries capped at 500 chars, per-seat `{chars, claims}` counts, **NOT full answers text**. Full seat answers already persist in the workflow journals (`~/.claude/projects/*/*/subagents/workflows/*/journal.jsonl`), which is where the judge-harm audit (D2) mines them — asking an LLM to transcribe 100k chars into a heredoc is exactly the corruption mode this repo already fixed for diffs (A2 in fusion-review.js).
- `gpt_retried` is logged (the `withCodexRetry` flag), covering the attack's wrapper-flakiness observability fix.
- fusion-review's `NO_DIFF` early return is not logged — no judge data, no value.

Verify after the next real run: `wc -l ~/.fusion-council/telemetry.jsonl` and `eval/analyze.sh`.

### A2. Row schema

```
ts            ISO timestamp (shell-supplied at append time)
run_id        unique per append (epoch-pid-random; the join/dedup key — ts alone collides within a second)
workflow      "fusion-plan" | "fusion-review"
arm           "full" | "nogpt" | "duo" — eval ablation arm (default "full")
cwd           repo the run happened in (shell $PWD; joins bench runs to cases)
panel         e.g. ["fusion-architect","fusion-skeptic","fusion-test-strategist","fusion-maintainer","gpt-gpt-5.5"]
gpt_ran       bool (seat label is literally "gpt-gpt-5.5" = `gpt-${codexModel}`)
gpt_retried   bool — the GPT seat needed its one CODEX_UNAVAILABLE retry (wrapper-flakiness observability)
codexModel/codexEffort
judge         judge JSON {consensus, contradictions, uniqueInsights, coverageGaps, blindSpots, invalidClaims},
              each entry capped at 500 chars (attribution prefix + enough text for fuzzy matching)
coverage      the coverage string
seats         [{panelist, chars, claims}] — claims = bullet/numbered-line count of the seat's raw answer;
              the survival-per-claim denominator (Goodhart guard). Full answer text lives in the journals.
subject_head  first 200 chars of task/diff (dedupe key; not full text for privacy/size)
```

Ack rows (from `eval/ack.sh y|n [note]`, the online acted-on signal): `{ack:true, ts, run_id, acted_on, note}`. Dropped-copy stubs: `{dropped:true, workflow, ts, cwd, run_id}`.

### A3. Per-seat metrics — IMPLEMENTED as `eval/analyze.sh`

Judge entries are free-text prefixed `"panelist: …"`, and the judge may write `gpt-5.5`, `gpt-gpt-5.5`, or `GPT`; the script normalizes the prefix. The original inline jq draft had the survival-check binding bug the methodology attack flagged (§3, minor #9); the shipped script binds the outer insight before matching (normalized 40-char keys), skips corrupt lines (`fromjson? // empty`), counts `runs_ran` from `panel`, sums the `claims` denominators, and folds in ack rows. Run:

```bash
eval/analyze.sh            # reads ~/.fusion-council/telemetry.jsonl
eval/ack.sh y "fixed both" # annotate the last run: was its output acted on?
```

With `N_gpt = jq -s '[.[]|select(.gpt_ran)]|length' telemetry.jsonl` (runs where the seat actually ran), define:

| metric | formula | reading |
|---|---|---|
| **surviving-uniqueInsight rate (seat)** | `surviving_unique_total(seat) / N_runs(seat ran)` | mean judge-validated distinctive insights per run |
| **decisive-run rate (seat)** | `runs_with_surviving(seat) / N_runs(seat ran)` | share of runs where the seat added ≥1 surviving insight |
| **invalidClaim (FP) rate (seat)** | `invalid_total(seat) / (invalid_total + surviving_unique)(seat)` | of the seat's judge-noticed distinctive output, what fraction was junk (judge-visible proxy) |
| **survival-per-claim (seat)** | `surviving_unique(seat) / claims_total(seat)` | Goodhart guard: a seat spraying claims to win uniqueInsights lottery tickets shows a falling per-claim rate even as its per-run rate rises |
| **GPT marginal contribution** | GPT's surviving-uniqueInsight rate + decisive-run rate, vs. the same numbers for the median Claude seat | observational answer to question (1) |
| **acted-on rate** | `acks(yes) / acks(total)` from `eval/ack.sh` annotations | the only non-circular signal in §A: did the owner actually act on the run's output? |

Survival here = listed in `uniqueInsights` and not fuzzy-matching (normalized 40-char prefix) any `invalidClaims` entry of the same run — the same gate synthesis applies. Cross-check occasionally against the synthesized output text; the proxy is what makes this free.

---

## B) Seeded-defect benchmark for fusion-review

### B0. Ablation switches — IMPLEMENTED 2026-07-02

Both live in the workflows, default OFF (real usage unaffected), and the telemetry row records `arm`:

- `args.noGpt` (fusion-review.js) — council minus the GPT seat (the GPT-marginal arm).
- `args.duo` (fusion-review.js AND fusion-plan.js) — ONE generalist opus seat + GPT + the same judge/synthesize. **This is the literature-pointed comparator the full role panel must beat** (~half cost; keeps only the two mechanisms the verified sweep supports: cross-family seat + grounded judge). The generalist seat gets the same two-section dimension list as the GPT seat, so prompt strength is equalized across arms.

Coverage honestly reports "UNAVAILABLE" for `noGpt` runs; that's fine and self-documenting in telemetry.

### B1. Layout

```
/Users/sanghyeon/projects/fusion-plan/eval/
  cases/NNN/case.json     # manifest
  cases/NNN/bug.patch     # the seeded working-tree change (bug + decoys)
  run_case.sh  run_bench.sh  grade_case.sh  analyze.sh
  results/bench.jsonl
```

`case.json`:

```json
{ "id": "007", "kind": "mutation|regression",
  "repo": "/abs/path/to/source-repo-or-clone", "ref": "<sha>",
  "truth": { "file": "src/x.js", "lines": "41-44",
             "desc": "off-by-one: loop uses <= so last element processed twice",
             "match_regex": "off.by.one|<=.*length|twice|duplicate.*last" },
  "decoy_files": ["src/y.js", "README.md"] }
```

### B2. Building 15–30 cases (target: **20**)

- **~12 mutation-style**: clone a real repo with tests (a mid-size TS/JS OSS repo, or a work repo), pick a clean sha, hand-write one semantic bug per case from this palette: inverted condition, `<`↔`<=`, dropped `await`, swapped args, wrong default on missing key, deleted null-check with a reachable null, stale cache key, off-by-one slice, error swallowed by a broad catch, timezone-naive date compare, resource not closed on early return, wrong operator precedence. **Critical realism rule: every `bug.patch` must also contain 30–150 lines of benign decoy edits** (a rename, a comment fix, an added helper) — a 1-line diff makes recall trivially 100% and precision meaningless. Verify the bug is real: the repo's tests (or a 5-line repro) must fail with the patch applied.
- **~8 real regressions**: mine the source repo's history for fix commits (`git log --grep='fix' --oneline`). Recipe per case: `git checkout <fix_sha>` then `git revert --no-commit <fix_sha>` → the working-tree diff *reintroduces* the historical bug; the fix commit message is the truth description. These give you organic, non-synthetic bugs for free.

### B3. Running (scratch repo per case × 4 arms)

`run_case.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
CASE=$1 ARM=$2                              # ARM: full | nogpt | duo | solo
E=/Users/sanghyeon/projects/fusion-plan/eval
CJ=$E/cases/$CASE/case.json
W=$(mktemp -d); git clone -q --local "$(jq -r .repo $CJ)" "$W"
git -C "$W" checkout -q "$(jq -r .ref $CJ)"
git -C "$W" apply "$E/cases/$CASE/bug.patch"          # unstaged → it IS the working-tree diff
case $ARM in
  full)  PROMPT='Invoke the fusion-review skill (fusion-council:fusion-review) and print the returned review verbatim.';;
  nogpt) PROMPT='Run Workflow({scriptPath:"'"$FUSION_PLUGIN_ROOT"'/workflows/fusion-review.js", args:{noGpt:true}}) and print the returned review verbatim.';;
  duo)   PROMPT='Run Workflow({scriptPath:"'"$FUSION_PLUGIN_ROOT"'/workflows/fusion-review.js", args:{duo:true}}) and print the returned review verbatim.';;
  solo)  D=$(git -C "$W" diff)
         PROMPT="Review the following working-tree diff. Be terse and actionable; ground every finding in a file/line or a concrete behavior. Do not suggest unrelated cleanup. Report every real issue you find as: Severity / File / Issue / Suggested fix.

DIFF:
$D";;
esac
( cd "$W" && claude -p "$PROMPT" --model opus --output-format json --dangerously-skip-permissions ) \
  > "$E/results/$CASE.$ARM.json"
jq -n --arg case "$CASE" --arg arm "$ARM" \
  --slurpfile r "$E/results/$CASE.$ARM.json" \
  '{case:$case, arm:$arm, cost:($r[0].total_cost_usd), review:($r[0].result)}' \
  >> "$E/results/bench.jsonl"
rm -rf "$W"
```

Notes: `--dangerously-skip-permissions` (or a scratch-repo allowlist) is required because the council spawns Bash-running subagents headlessly; `total_cost_usd` from the headless JSON is your cost measurement; the workflow's own telemetry (part A) simultaneously lands the judge JSON + raw seat answers in `~/.fusion-council/telemetry.jsonl` with `cwd`=$W — join bench↔telemetry on cwd/timestamp. **Arms `full` and `nogpt` are the GPT ablation; arm `solo` is one Opus, same framing, no council** (exact token-budget matching is over-engineering — report cost next to recall instead, which shows the budget difference honestly).

`run_bench.sh` is the trivial double loop. **Run a 5-case pilot first** to shake out headless-skill invocation and calibrate real cost, then the remaining 15.

### B4. Grading (`grade_case.sh`)

1. **Recall (auto-first)**: `grep -Eiq "$(jq -r .truth.match_regex $CJ)" <<<"$review"` → FOUND. On regex miss, one cheap fallback call: `claude -p --model sonnet "TRUTH: <desc> at <file:lines>. REVIEW: <text>. Did the review identify this specific bug (same root cause, not just the same file)? Answer exactly FOUND or MISSED."`
2. **Precision (mostly auto by construction)**: split the report's `## Findings` bullets. A finding matching truth = TP. A finding citing only `decoy_files` lines = **FP automatically** (decoys are benign by construction — this is why decoys matter). Anything else (pre-existing real issue the council legitimately caught) → tiny manual audit pile; expect <2/case.
3. **Judge-harm attribution for every miss**: grep the run's **workflow journal** (per-seat raw answers in `~/.claude/projects/*/*/subagents/workflows/*/journal.jsonl` — telemetry deliberately does NOT carry full answer text) for the truth regex. If some seat's raw answer had it → the miss was a **judge/synth drop**, not a panel miss. Record `miss_cause: panel|judge`.

### B5. Metrics

```
recall(arm)            = found / 20
gpt_marginal_recall    = recall(full) − recall(nogpt)          # question (1), causal version
role_panel_marginal    = recall(full) − recall(duo)            # THE decisive comparison (verified sweep):
                                                               # do 3 role seats beat 1 generalist at 2× cost?
council_marginal_recall= recall(full) − recall(solo)
fp_per_run(arm)        = mean count of FP findings
precision(arm)         = TP / (TP + FP)
cost_per_confirmed(arm)= Σ total_cost_usd(arm) / Σ (TP + audited-real extras)(arm)
judge_harm_share       = judge-caused misses / all misses      # feeds D2
```

Noise floor: with 20 cases, treat any recall gap of **≤1 bug (5pp)** between arms as noise; ≥3–4 bugs as real (informal McNemar).

Budget: 20 cases × (full + nogpt) ≈ 40 council runs ≈ **$60–160**, + 20 cheap solo runs + pennies of grading. That is the single most expensive line item in this harness — hence pilot-first.

---

## C) Plan quality

### C1. Blinded pairwise A/B (10 tasks, ~$30–40)

- **Tasks**: 10 real, planned-anyway tasks from the backlog → `eval/plan_tasks.jsonl`: `{id, task, repo, acceptance_cmd}`.
- **Generate per task** (in the task's repo): fusion plan via `claude -p "Invoke fusion-council:fusion-plan with task: <task>. Print the returned plan verbatim."`; **primary baseline = duo** via `claude -p "Run Workflow({scriptPath:'<plugin>/workflows/fusion-plan.js', args:{task:'<task>', duo:true}}) and print the returned plan verbatim."` (the verified sweep's comparator — full-vs-duo is the decisive pair); solo reference via `claude -p --model opus "PLAN ONLY, do not implement: <task>. Output: assumptions; steps each with a verify check; risks; verification commands."`
- **De-fingerprint (mandatory)**: fusion output screams its origin (`# Fusion Plan`, `## Cross-Model Notes`, `## Council Coverage`). Before grading, `sed` both plans into a neutral template — delete the `Cross-Model Notes` and `Council Coverage` sections, strip the H1, normalize headers. A "blinded" comparison without this step is fake.
- **Grader = family NOT on the panel.** Panel = Claude + GPT-5.5, so the grader must be **Gemini** (`gemini -p` CLI, free tier suffices). Do not substitute GPT-5.4 "because codex is handy" — same family as a panelist, biased toward its own seat's content. If Gemini access is truly impossible, human-grade the 10 pairs (it's 10 pairs).
- **Grade**: 2 calls per task with position swapped (A/B then B/A). Prompt: task + `git ls-files` output (so the grader can spot hallucinated paths without repo access) + both plans + rubric: (1) no hallucinated files/APIs, (2) step specificity + per-step verify, (3) risk coverage, (4) minimality. Output `WINNER: A|B|TIE` + one sentence. Task winner = both orderings agree, else TIE.
- **Metric**: fusion win rate over 10. Sign test: **≥9/10 → p<0.05 real win; 8/10 suggestive; 5–7 → wash** (a wash means the council isn't paying for itself on plan quality).

### C2. Downstream execution (5 tasks, ~$20–30 — the high-signal tiebreaker)

Pick the 5 tasks with a mechanical `acceptance_cmd` (test suite / repro script). For each plan (fusion + baseline): fresh `git worktree`, then `claude -p --model sonnet "Implement EXACTLY this plan. Do not deviate or improvise beyond it: <plan>"`, then run `acceptance_cmd`. **Executor is deliberately sonnet, not opus** — a good plan should carry a weaker executor; that's what plans are for. Metric: `exec_success(fusion) − exec_success(baseline)` out of 5, plus executor cost/turn count as a "plan clarity" proxy.

---

## D) Kill metrics (2–3 numbers that justify deleting things)

1. **GPT-seat kill** — *"drop the mandatory GPT seat"*: over **≥20 telemetry runs where `gpt_ran`**, GPT surviving-uniqueInsight rate **< 0.2/run** and decisive-run rate **< 10%**, **AND** bench `recall(full) − recall(nogpt) ≤ +1/20`. Both observational and causal arms agreeing → the diversity story is dead; the seat costs wall-time and wrapper flakiness for nothing. (Memory note: GPT $ cost is 0, so the bar is signal, not spend — but a seat adding zero surviving signal is still coverage-string theater.)
2. **Judge-harm kill** — *"demote the judge's drop authority"*: (a) bench `judge_harm_share ≥ 30%` (≥ ~1/3 of misses are cases where a panelist's raw answer contained the seeded bug but the judge/synth dropped it), **or** (b) audit of ~30 sampled `invalidClaims` from real telemetry (stratified per seat, graded against the repo by you or the Gemini grader) shows **>40% were actually valid**. Either → the merit gate is destroying recall; flip findings to survive-by-default and make `invalidClaims` advisory annotations. (This directly tests the v0.1.6 single-gate FP-reduction design.)
3. **Role-panel kill** — *"cut the Claude role seats to duo"* (added 2026-07-02 after the verified sweep: persona/role prompts show replicated null accuracy effects, and every measured SE-ensemble win is selection, not role diversity): bench `recall(full) − recall(duo) ≤ 1/20` **AND** plan A/B full-vs-duo is a wash (≤ 6/10). → replace the role panel with the duo config (1 generalist opus + GPT + same judge, ~half cost); keep the role .md files only if telemetry shows role-specific surviving insights the generalist misses. Apply the §3 statistical fixes (gray zone, CIs, replication) before pulling this trigger.
4. **Whole-council kill** — *"one Opus was enough"*: `recall(full) − recall(solo) ≤ 1/20` **AND** plan win rate ≤ 6/10, while `cost_per_confirmed(full) ≥ 3 × cost_per_confirmed(solo)`. → keep a single-Opus review + optional zero-cost codex cross-check, delete the council pipeline.

---

## Execution order & total budget

| step | what | cost | answers |
|---|---|---|---|
| 1 | ✅ DONE 2026-07-02: telemetry append (A) + `noGpt`/`duo` args (B0) + `analyze.sh`/`ack.sh` | ~$2 | infrastructure |
| 2 | let telemetry accumulate on real usage (target 20 runs) | $0 marginal | (1) observationally, D1a |
| 3 | build 20 cases + **5-case pilot** across 4 arms | ~$30 | harness works, real $/run |
| 4 | remaining 15 cases × 4 arms + grading | ~$90–190 | (2), D1b, D2a, D3, D4 |
| 5 | plan A/B, 10 tasks (fusion vs **duo**, + solo reference) + Gemini grading | ~$45 | (3) blinded, D3 |
| 6 | downstream execution, 5 tasks × 2 | ~$25 | (3) causal |

Total ≈ **$190–290**, front-loaded on the fusion-review benchmark because that's where the falsifiable claims live. Steps 1–2 alone (free) already answer D1's observational half — if GPT's surviving-insight rate is ~0 after 20 organic runs, you can kill the seat before ever paying for step 4's `nogpt` arm.

Implemented so far (2026-07-02): telemetry seats + `arm`/`gpt_retried` fields in both workflows; `eval/analyze.sh` (per-seat scoreboard incl. survival-per-claim and `[cross-family]` consensus rate) and `eval/ack.sh` (acted-on annotations); `noGpt`/`duo` ablation args; cross-family-only corroboration rule in both judge prompts. Telemetry lands at `~/.fusion-council/telemetry.jsonl`.

## 3) Methodology attack — flaws in the harness above and required fixes

*A hostile methodology review of section 2. Apply these fixes before trusting any kill metric.*

### [FATAL] The 'solo' baseline is a strawman, so the whole-council kill metric (D3) answers the wrong question. One single-shot Opus call (~$0.2-0.5) is compared against a $1.5-4 council, and the design explicitly waves off budget matching as 'over-engineering'. But the research section's single strongest finding (Self-MoA, Smit et al., Huang et al.) is that the baseline that actually wins at matched budget is repeated sampling/self-consistency of the strongest model — an arm this harness never runs. D3 therefore presents a false dichotomy: 'council' vs 'one cheap call'. If the council beats solo by 2-3 bugs, the owner keeps a $4/run pipeline that 3x-sampled Opus plus a cheap merge might match at a third of the cost — the exact outcome the literature predicts. The solo prompt is also weaker than the council seats' prompts (no role/dimension checklist), violating the Wang et al. finding that a single agent with a strong prompt matches multi-agent setups; part of any council win is just prompt surface area.

**Fix:** Add a fourth arm 'solo-k' to run_case.sh: k independent Opus reviews of the same diff (k chosen so pilot-measured cost matches the full arm, likely k=3-4) merged by one sonnet dedup pass; give the solo arms the union of the role seats' dimension checklists so prompt strength is equalized. ~$25 more, and it is the only arm that can answer 'does heterogeneity earn its cost'.

### [FATAL] The kill thresholds are statistically miscalibrated for the sample sizes — they will delete working components on coin-flip evidence. Concretely: D1's bench gate 'recall(full)−recall(nogpt) ≤ +1/20' kills a GPT seat that truly adds +10pp recall (uniquely catches ~2/20 bugs) with probability P(X≤1 | Bin(20,0.1)) ≈ 0.39. D3's plan gate 'win rate ≤ 6/10' fires with probability ~0.49 on a council whose true plan win rate is 65% (a genuinely valuable margin). C1's success bar of 9/10 requires a true win rate ≥ ~85% for even 50% detection power. C2's n=5 execution arm cannot distinguish anything short of 5-0. Each case×arm also runs exactly once, so council run-to-run variance (nondeterministic seats, codex retry flakiness) is folded invisibly into the between-arm comparison. The harness's own noise floor ('≤1 noise, ≥3-4 real') leaves the 2-bug region undefined — precisely where the decisions will land.

**Fix:** Make kills two-sided and sequential instead of one-shot: predefine a gray zone (bench delta of exactly 2, plan wins 6-8) that triggers adding 10-15 more cases/tasks before deciding; report binomial CIs next to every kill metric; require the same kill to replicate on the extension set before deleting anything; demote C2 (n=5) from 'tiebreaker' to grader-calibration only.

### [FATAL] Seeded-bug construction + leakage bias every arm toward the ceiling, and ceiling compression reads as 'no difference' — which the kill metrics interpret as 'delete'. Three compounding problems: (a) the 12 mutation cases are single-hunk classic mutations (inverted condition, off-by-one, dropped await) — the easiest, most linter-like class; if all arms score 85-95%, recall deltas are structurally ~0 regardless of GPT's true value on hard bugs, and D1/D3 fire wrongly. (b) The 8 revert-based regressions leak three ways: run_case.sh does a full-history `git clone --local`, so the fix commit — whose message IS the truth description — sits in `git log` of the scratch repo, and the solo arm runs with --dangerously-skip-permissions in that repo and can trivially read it; the upstream repo is popular OSS almost certainly in every panel model's pretraining, so 'detecting' a reverted public fix measures memorization-anomaly, not review skill (the Defects4J result in the research: 82% vs 48% 5-gram reproduction); leakage strength differs by model family and training recency, corrupting the GPT-vs-Claude comparison specifically. (c) All ~12 mutation cases come from one repo ('clone a real repo', singular), so errors cluster and effective N is well below 20; and there are zero clean-diff cases, so the false-positive floor of each arm is never measured.

**Fix:** In run_case.sh, after checkout: `rm -rf .git && git init && git add -A && git commit -q -m init` before applying bug.patch (capture only needs a working-tree diff). Source regression cases from post-cutoff (2026) fix commits or the private work repo, not old popular OSS. Spread mutations over ≥3 repos, add ≥3 cross-file/multi-hunk bugs, and add ~5 clean-diff (decoys-only) cases to measure the FP floor per arm.

### [MAJOR] The observational per-seat metrics (A3, feeding kill metric D1a) are judge-circular with a documented family-bias direction: the Opus judge decides uniqueInsights and invalidClaims, and the research in hand says Claude judges show the largest measured self-preference (+25%) plus affinity for familiar low-perplexity text. Worse, the pipeline's own grounding rule (fusion-review.js lines 179-186: 'be willing to drop a weakly-grounded SINGLE-SOURCE finding') structurally targets the GPT seat — it is always single-source for its family and has the least repo access to produce path:line grounding (it sees only the diff/prompt, no file reads). So GPT's invalidClaim rate is inflated and its surviving-insight rate deflated by design, and D1a will read that as 'GPT adds junk'. The metric also assigns exactly zero to GPT's corroboration value: uniqueInsights only counts findings ONE seat raised, but the seat's design purpose (per the workflow comments and the 'Cross-Model Agreement' output section) is cross-family confirmation that triggers the judge's 'NEVER drop a cross-model finding' protection. A seat can be decisively valuable while scoring 0.0 on every A3 metric.

**Fix:** Demote telemetry seat-metrics to descriptive-only — never a kill input; require the causal bench arm alone for D1. Add one cheap metric to analyze.sh: per-seat consensus-participation rate (does the judge's consensus/cross-model list cite content the GPT answer contains — sonnet-checked on a sample). Change JUDGE_SCHEMA so invalidClaims reference uniqueInsight indices instead of free text, making survival attribution mechanical.

### [MAJOR] Goodhart trap: 'surviving-uniqueInsights per run' has no per-claim denominator (the design admits total claims per seat aren't emitted), and the judge dedups — so every extra claim a seat emits is a free lottery ticket for uniqueInsights with no observable penalty. The moment the owner tunes seat prompts against this scoreboard (its stated purpose), selection pressure favors verbose seats spraying exotic single-source claims — exactly the recall-up/precision-collapse failure the research documents for union-style aggregation (F1 61.4 vs 71.6). Meanwhile nothing in the harness measures real-usage FP burden: there is no acted-on/dismissed signal on actual reviews, which the research (Martian, Cursor, Anthropic) identifies as the only metric that catches what offline gold sets miss.

**Fix:** Log a per-seat findings-count in telemetry (count '## '/bullet items in each answer, or have the judge emit totalClaims per panelist) and report survival-per-claim, not survival-per-run. Add one field to real usage: after each fusion-review, append acted_on: y/n to the telemetry row (one keystroke). Pre-register the metric definitions now, before any seat-prompt tuning, and never tune and evaluate on the same telemetry window.

### [MAJOR] C1's blinding is fake beyond the headers it strips. The two arms are generated under different mandated templates: fusion's synthesized plan (fusion-plan.js lines 203-208) contains 'Relevant Context', 'Do Not Do', 'Open Questions' sections that the sed step does not remove (it only deletes Cross-Model Notes, Council Coverage, and the H1), while the baseline prompt mandates a different 4-part structure — so the Gemini grader can identify the council arm from structure alone on every pair. There is also no length control at all, despite the research dump itself citing verbosity bias and LC-AlpacaEval's correction: council plans will be systematically longer, and long+comprehensive-looking wins biased judges. The comparison as designed measures template-and-length, not plan quality.

**Fix:** After generation, pass BOTH plans through one identical haiku reformat call ('rewrite into exactly these sections: Assumptions / Steps with verify / Risks / Verification commands; max 400 words; preserve content, change nothing else'), then grade. Also report mean length per arm next to the win rate — if the winner is also always 2x longer, treat the result as suspect.

### [MAJOR] Ablation integrity hole: in the 'full' arm, a double CODEX_FAIL silently degrades the run to Claude-only — fusion-review.js drops the seat (line 158) and continues, coverage says UNAVAILABLE, but run_case.sh still records arm=full in bench.jsonl, and B5's formulas never check gpt_ran. Given the wrapper's observed flakiness (the retry exists because sonnet spuriously bails ~1.6s in), several 'full' data points will actually be nogpt runs, diluting gpt_marginal_recall toward zero — which biases directly toward the D1 kill. Same issue contaminates observational N_gpt if runs are counted by arm rather than by actual seat participation.

**Fix:** In run_case.sh after a full-arm run, read the matching telemetry row (join on cwd) and rerun the case if gpt_ran is false (cap at 2 retries, else mark the case excluded-from-D1); have analyze.sh compute N_gpt strictly from gpt_ran, never from arm labels.

### [MAJOR] Precision is rigged by the decoy auto-FP rule: any finding citing only decoy files is scored FP 'by construction', but the realism rule demands 30-150 lines of decoy edits including renames and added helpers — edits that legitimately warrant findings (rename missing a call site, helper without tests, dead parameter). Auto-FP-ing these punishes exactly the higher-recall, more-thorough arm (likely the council), and unlike 'anything else' findings, decoy-cited findings never reach the manual audit pile. This recreates the documented 'incomplete gold set corrupts the precision numerator' problem the research section itself flags (Martian, Augment), but bakes it in by rule instead of by accident.

**Fix:** Route decoy-cited findings through the same sonnet audit as unclassified findings (it is <2/case anyway), or constrain decoys to provably inert edits (comment wording, doc strings, whitespace-adjacent refactors verified by the repo's test suite passing on the decoy-only patch).

### [MINOR] Judge-harm attribution (D2a / B4 step 3) grades misses by regex-grepping the truth match_regex over raw seat answers — patterns like 'off.by.one|<=.*length|duplicate' will match incidental text in a 20k-char review answer, overcounting 'panel had it, judge dropped it' and inflating judge_harm_share toward the ≥30% kill trigger for the v0.1.6 gate design. Separately, the analyze.sh survival gate is literally broken as written: inside `any($inv[]; ...)` jq rebinds `.` to the invalidClaims element, so the outer uniqueInsight is never referenced in the match predicate — unique_killed is structurally ~always 0 and 'surviving' silently degrades to raw uniqueInsights counts.

**Fix:** Use the same sonnet FOUND/MISSED semantic check for per-seat miss attribution that B4 uses for recall (a few cents per miss). Replace the jq fuzzy match with mechanical ID references (see the JUDGE_SCHEMA fix) or at minimum bind the outer insight before the any() and compare both normalized strings explicitly.

### [MINOR] No grader is ever validated against human labels: the sonnet FOUND/MISSED fallback, the decoy/extras audit, the Gemini pairwise grader, and the D2b invalidClaims audit ('graded by you or the Gemini grader') all go unchecked, even though the research section's own recipe requires human-validated LLM-judge matching (~90% agreement) and the D2b audit has the owner grading his own system's drops (confirmation bias) or Gemini grading concrete code claims without repo context (cannot verify them).

**Fix:** Hand-label the 5-case pilot (15 arm-runs) and the first 5 plan pairs; proceed with automated grading only if agreement ≥90%, else tighten the grader prompt and re-check. For D2b, give the grader the case diff plus the cited file excerpts, and blind it to which seat raised the claim.

### [MINOR] Cost accounting is asymmetric in ways that flatter the council: total_cost_usd excludes the GPT seat entirely (subscription-framed as $0, but it costs wall-time and the acknowledged wrapper flakiness — neither measured), and cost_per_confirmed's denominator includes 'audited-real extras' whose adjudication depends on the owner's incomplete-gold-set judgment calls, applied per-arm with different finding volumes. Two arms can differ on cost_per_confirmed purely through audit generosity, and D3 uses a 3x ratio of this number as a kill condition.

**Fix:** Log wall-clock duration and gpt retry count per run in the telemetry row (both already observable); for the D3 ratio, restrict the denominator to seeded-truth TPs only (identical universe across arms) and report audited extras separately as a descriptive column.
