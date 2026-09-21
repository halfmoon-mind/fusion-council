#!/usr/bin/env bash
# usage: eval/analyze.sh [--bench] [wf_*.json ...]
# Scoreboard from the workflow journals the harness writes for every run
# (~/.claude/projects/*/*/workflows/wf_*.json): result.{judge,panel,stats}, status, durationMs, totalTokens,
# per-seat model/tokens. Replaces the telemetry.jsonl append seat (0.5.0). Bench runs (scratch repos under
# $TMPDIR) are excluded unless --bench. Runs older than 0.5.0 have no result.stats: arm/gpt_ran are derived
# from the panel + agent labels, claim counts are simply absent.
# DESCRIPTIVE only: the judge is the scorer (circular) — never a kill-metric input on its own.
set -euo pipefail
BENCH=false; [ "${1:-}" = --bench ] && { BENCH=true; shift; }
if [ $# -gt 0 ]; then FILES=("$@"); else FILES=("$HOME"/.claude/projects/*/*/workflows/wf_*.json); fi
[ -e "${FILES[0]}" ] || { echo "no workflow journals found" >&2; exit 1; }

jq -c 'select(.workflowName == "fusion-review" or .workflowName == "fusion-plan") | . + {file: input_filename}' "${FILES[@]}" \
| jq -s --argjson bench "$BENCH" '
  def seat: (ascii_downcase | split(":")[0]) as $p |
    if   ($p | test("gpt|codex"))  then "gpt"
    elif ($p | test("architect"))  then "architect"
    elif ($p | test("skeptic"))    then "skeptic"
    elif ($p | test("test"))       then "test-strategist"
    elif ($p | test("maintain"))   then "maintainer"
    elif ($p | test("generalist")) then "generalist"
    else "other" end;
  def median: sort | if length == 0 then null elif length % 2 == 1 then .[(length-1)/2] else (.[length/2-1] + .[length/2]) / 2 end;
  def pct2: if . == null then null else (. * 100 | round) / 100 end;
  def agents: [(.workflowProgress // [])[] | select(.type == "workflow_agent")];
  def seatlabel: .label | sub(" \\(retry \\d+\\)$"; "") | sub("^panel:gpt-.*$"; "panel:gpt");
  def panel: .result.panel // [];
  def arm: .result.stats.arm //
    ((if (panel | any(startswith("fusion-"))) then (if (panel | any(startswith("gpt-"))) then "full" else "nogpt" end)
      else (if (panel | any(startswith("gpt-"))) then "duo" else "duo-nogpt" end) end)
     + (if (agents | any(.label == "judge+synthesize")) then "-merged" else "" end));
  def gpt_ran: .result.stats.gpt_ran // (panel | any(startswith("gpt-")));

  map(select($bench or (.file | test("/-private-var-folders-.*-T-tmp") | not))) as $all
  | ($all | map(select(.status == "completed" and .result.judge))) as $done
  | {
      runs: ($all | length),
      by_arm: ($all | group_by([.workflowName, arm]) | map({
        workflow: .[0].workflowName, arm: (.[0] | arm), runs: length,
        status: (group_by(.status) | map({(.[0].status): length}) | add),
        gpt_ran: ([.[] | select(gpt_ran)] | length),
        wall_min_med:  ([.[] | select(.status == "completed") | .durationMs / 60000] | median | pct2),
        tokens_k_med:  ([.[] | select(.status == "completed") | .totalTokens / 1000] | median | pct2) })),
      # error-decorrelation in practice: the judge tags consensus BOTH families raised with [cross-family]
      consensus: { total: ($done | map(.result.judge.consensus // [] | length) | add // 0),
                   cross_family: ($done | map([(.result.judge.consensus // [])[] | select(startswith("[cross-family]"))] | length) | add // 0) },
      # per-seat tokens: shows what each seat really costs (and which model actually ran it)
      seat_tokens: ([$done[] | agents[] | select(.tokens) | {l: seatlabel, t: (.tokens | tonumber), m: .model}]
        | group_by(.l) | map({ label: .[0].l, n: length, tokens_k_med: ([.[].t / 1000] | median | pct2),
                               models: (group_by(.m) | map({(.[0].m // "?"): length}) | add) })
        | sort_by(-.tokens_k_med)),
      per_seat: (
        [ $done[] | (panel[] | { s: seat, kind: "ran", n: 1 }),
                    ((.result.stats.seats // [])[] | { s: (.panelist | seat), kind: "claim", n: (.claims // 0) }),
                    ((.result.judge.uniqueInsights // [])[] | { s: seat, kind: "unique", n: 1 }),
                    ((.result.judge.invalidClaims // [])[] | { s: seat, kind: "invalid", n: 1 }) ]
        | group_by(.s)
        | map({ seat: .[0].s,
                runs_ran:     ([.[] | select(.kind == "ran")] | length),
                claims_total: ([.[] | select(.kind == "claim") | .n] | add // 0),
                unique:       ([.[] | select(.kind == "unique")] | length),
                invalid:      ([.[] | select(.kind == "invalid")] | length) }
          | . + { unique_per_run:   (if .runs_ran > 0 then (.unique / .runs_ran | pct2) else null end),
                  unique_per_claim: (if .claims_total > 0 then (.unique / .claims_total | pct2) else null end),
                  fp_rate: (if (.invalid + .unique) > 0 then (.invalid / (.invalid + .unique) | pct2) else null end) })
        | sort_by(-.unique))
    }
'
