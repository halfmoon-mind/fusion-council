#!/usr/bin/env bash
# usage: eval/analyze.sh [telemetry.jsonl]
# Per-seat scoreboard from real fusion-plan/fusion-review usage (EVAL.md §A).
# DESCRIPTIVE only: the judge is the scorer (circular) — never a kill-metric input on its own.
set -euo pipefail
IN="${1:-$HOME/.fusion-council/telemetry.jsonl}"
[ -f "$IN" ] || { echo "no telemetry at $IN" >&2; exit 1; }

# fromjson? // empty: a row the sonnet seat mangled (and jq -e somehow let through) is skipped, not fatal.
jq -cR 'fromjson? // empty' "$IN" | jq -s '
  def seat: (ascii_downcase | split(":")[0]) as $p |
    if   ($p | test("gpt|codex|5\\.5")) then "gpt"
    elif ($p | test("architect"))       then "architect"
    elif ($p | test("skeptic"))         then "skeptic"
    elif ($p | test("test"))            then "test-strategist"
    elif ($p | test("maintain"))        then "maintainer"
    elif ($p | test("generalist"))      then "generalist"
    else "other" end;
  # Kill-match: an insight is "killed" if any invalidClaims entry of the same run CONTAINS the
  # normalized 40-char key of the insight (invalidClaims = "panelist: claim — why", so containment
  # beats equality). Judge semantics keep the two lists disjoint by construction, and paraphrased
  # kills will NOT match — this UNDER-detects killed insights; treat surviving_* as an upper bound.
  def norm: ascii_downcase | gsub("[^a-z0-9]";"") | .[0:40];
  def normfull: ascii_downcase | gsub("[^a-z0-9]";"");
  def pct2: . * 100 | round / 100;

  . as $all
  | ($all | map(select(.judge))) as $runs
  | ($all | map(select(.ack))) as $acks
  | {
      runs: ($runs | length),
      dropped_rows: ($all | map(select(.dropped)) | length),
      by_workflow: ($runs | group_by(.workflow) | map({(.[0].workflow): length}) | add // {}),
      by_arm: ($runs | group_by(.arm // "full") | map({(.[0].arm // "full"): length}) | add // {}),
      gpt_ran_runs: ($runs | map(select(.gpt_ran)) | length),
      gpt_retried_runs: ($runs | map(select(.gpt_retried)) | length),
      # error-decorrelation in practice: judge tags consensus BOTH families raised with [cross-family]
      consensus: { total: ($runs | map(.judge.consensus // [] | length) | add // 0),
                   cross_family: ($runs
                     | map([(.judge.consensus // [])[] | select(startswith("[cross-family]"))] | length)
                     | add // 0) },
      acted_on: { acked: ($acks | length),
                  yes: ($acks | map(select(.acted_on == "y")) | length),
                  no:  ($acks | map(select(.acted_on == "n")) | length) },
      per_seat: (
        [ $runs[] as $r
          | ($r.run_id // $r.ts) as $rid
          | ($r.judge.invalidClaims // [] | map(normfull)) as $inv
          | ( (($r.panel // [])[] | { s: seat, kind: "ran", n: 1, run: $rid }),
              (($r.seats // [])[] | { s: (.panelist | seat), kind: "claim", n: (.claims // 0), run: $rid }),
              (($r.judge.uniqueInsights // [])[]
                | { s: seat,
                    kind: (if (norm as $k | $inv | any(contains($k))) then "unique_killed" else "unique_surviving" end),
                    n: 1, run: $rid }),
              (($r.judge.invalidClaims // [])[] | { s: seat, kind: "invalid", n: 1, run: $rid }) )
        ]
        | group_by(.s)
        | map(
            . as $g
            | { seat: $g[0].s,
                runs_ran:         ([$g[] | select(.kind == "ran")] | length),
                claims_total:     ([$g[] | select(.kind == "claim") | .n] | add // 0),
                surviving_unique: ([$g[] | select(.kind == "unique_surviving")] | length),
                unique_killed:    ([$g[] | select(.kind == "unique_killed")] | length),
                invalid_total:    ([$g[] | select(.kind == "invalid")] | length),
                decisive_runs:    ([$g[] | select(.kind == "unique_surviving") | .run] | unique | length) }
            | . + {
                surviving_per_run:   (if .runs_ran > 0 then (.surviving_unique / .runs_ran | pct2) else null end),
                decisive_run_rate:   (if .runs_ran > 0 then (.decisive_runs / .runs_ran | pct2) else null end),
                surviving_per_claim: (if .claims_total > 0 then (.surviving_unique / .claims_total | pct2) else null end),
                fp_rate: (if (.invalid_total + .surviving_unique) > 0
                          then (.invalid_total / (.invalid_total + .surviving_unique) | pct2) else null end) }
          )
        | sort_by(-.surviving_unique)
      )
    }
'
