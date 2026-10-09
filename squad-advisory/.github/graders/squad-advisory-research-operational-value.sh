#!/usr/bin/env bash

# Measures whether the current run requested a target-bound, triaged advisory
# plan for one repository. Ratio, higher is better: 1 conforming, 0
# contradictory, null when the assignment is unavailable or the run no-ops.

set -euo pipefail
export LC_ALL=C

[[ $# -eq 0 ]] || exit 2
request=$(cat)
jq -c '
  def text: type == "string" and test("[^[:space:]]");
  def kind: .type // .kind // "" | ascii_downcase | gsub("-"; "_");
  def target: .event.inputs.target_repo // .event.inputs.targetRepo // .config.target_repo // null;
  def expected_repo:
    if (.event.inputs.safe_output_mode // .config.safe_output_mode // "review") == "live"
    then target
    else .event.inputs.safe_output_repo // .event.inputs.safeOutputRepo // .run.repository // null
    end;
  if .schemaVersion != 1 or (.run | type) != "object" or (.event | type) != "object"
      or (.outputs | type) != "array" or (.config | type) != "object" then
    [{id:"decision-ready-repository-plan",value:null}]
  elif (target | type) != "string" or (target | test("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") | not) then
    [{id:"decision-ready-repository-plan",value:null}]
  elif (.outputs | length) == 1 and (.outputs[0] | kind) == "noop" then
    [{id:"decision-ready-repository-plan",value:null}]
  else
    target as $target | expected_repo as $expected
    | [.outputs[] | select(kind == "create_issue")] as $issues
    | [{id:"decision-ready-repository-plan",value:
        (if ($issues | length) == 1
            and (($issues[0].repo // $issues[0].repository // $issues[0].target_repo // $expected) == $expected)
            and (($issues[0].title // "") | text)
            and (($issues[0].body // "") | contains("**Action:**"))
            and (($issues[0].body // "") | contains("### Repository read"))
            and (($issues[0].body // "") | contains("### Recommended work"))
            and (($issues[0].body // "") | contains("### Decisions needed"))
            and (($issues[0].body // "") | contains("### Excluded"))
            and (($issues[0].body // "") | contains("### Evidence"))
            and (($issues[0].body // "") | contains("Squad perspectives"))
            and (($issues[0].body // "") | contains("Agent prompt"))
            and (($issues[0].body // "") | contains($target))
         then 1 else 0 end)}]
  end
' <<<"$request"
