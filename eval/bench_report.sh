#!/usr/bin/env bash
# usage: eval/bench_report.sh
# Per-arm bench scoreboard, re-ranked per EVAL.md §B5' (2026-07-14, post solo-saturation):
# precision/noise/cost lead; recall is split easy-anchor (001-004, sanity only) vs hard
# (solo-prescreened: 006 and 021+, the only discriminative recall signal).
# DESCRIPTIVE aggregation — kill decisions still need EVAL.md §3 statistical guardrails.
set -euo pipefail
E="$(cd "$(dirname "$0")" && pwd)"
B="$E/results/bench.jsonl"; G="$E/results/grades.jsonl"
[ -f "$B" ] && [ -f "$G" ] || { echo "no results under $E/results" >&2; exit 1; }
# only ACTIVE cases count — rows for discarded/_rejected cases linger in the jsonl and must not skew tiers
ACTIVE=$(ls "$E"/cases/*/case.json 2>/dev/null | xargs -n1 dirname | xargs -n1 basename | jq -Rc . | jq -sc .)

jq -n --argjson active "$ACTIVE" \
      --slurpfile b <(jq -c 'select(.case != "000-smoke")' "$B") \
      --slurpfile g <(jq -c 'select(.case != "000-smoke")' "$G") '
  ($b | map(select(.case as $c | $active | index($c)))) as $b |
  ($g | map(select(.case as $c | $active | index($c)))) as $g |
  def r2: . * 100 | round / 100;
  # hard = solo-prescreen-admitted mutations (006, 021+). Easy anchors 001-004 are sanity, not signal.
  def tier: if .kind == "clean" then "clean" elif .case >= "006" then "hard" else "easy" end;
  ($b | group_by(.arm) | map({
    arm: .[0].arm,
    runs: length,
    mean_wall_s: (([.[].wall_s] | add / length) | round),
    mean_cost: (([.[].cost] | add / length) | r2),
    gpt_ok: ([.[] | select(.gpt_ran == true)] | length),
    excluded_d1: ([.[] | select(.excluded_d1 == true)] | length)
  })) as $cost
  | ($g | map(. + {tier: tier})) as $gg
  | {
      per_arm_cost: $cost,
      recall: ($gg | map(select(.kind == "mutation")) | group_by(.arm) | map({
        arm: .[0].arm,
        easy: "\([.[] | select(.tier == "easy" and .found)] | length)/\([.[] | select(.tier == "easy")] | length)",
        hard: "\([.[] | select(.tier == "hard" and .found)] | length)/\([.[] | select(.tier == "hard")] | length)",
        miss_causes: ([.[] | select(.found == false) | .miss_cause] | group_by(.) | map({(.[0] | tostring): length}) | add // {})
      })),
      # noise burden: extra (non-truth) findings per bug-case run — the audit pile awaiting human/agent verdicts
      noise_bug_cases: ($gg | map(select(.kind == "mutation")) | group_by(.arm) | map({
        arm: .[0].arm,
        mean_extra_findings: (([.[].audit_pile | length] | add / length) | r2)
      })),
      # FP floor: findings on clean (decoys-only, accuracy-audited) diffs — target is 0
      clean_fp_floor: ($gg | map(select(.kind == "clean")) | group_by(.arm) | map({
        arm: .[0].arm,
        clean_runs: length,
        findings_total: ([.[].audit_pile | length] | add),
        mean_per_run: (([.[].audit_pile | length] | add / length) | r2)
      })),
      # SNR proxy: seeded-truth hits / (hits + extra findings). Crude until audit verdicts land.
      snr_proxy: ($gg | map(select(.kind == "mutation")) | group_by(.arm) | map(
        ([.[] | select(.found)] | length) as $tp
        | ([.[].audit_pile | length] | add) as $extra
        | { arm: .[0].arm, snr: (if ($tp + $extra) > 0 then ($tp / ($tp + $extra) | r2) else null end) }
      ))
    }
'
