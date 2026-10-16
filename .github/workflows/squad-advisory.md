---
name: "Squad Advisory"
description: "Selects authorized repositories for bounded, review-only farm evidence snapshots."
intent: Give native Squad evidence-backed context for planning across an explicitly enrolled repository farm without granting implementation authority.
run-name: "Squad Advisory"
max-ai-credits: 250
max-daily-ai-credits: -1
timeout-minutes: 15

concurrency:
  group: "${{ github.workflow }}"
  job-discriminator: ${{ github.run_id }}
  cancel-in-progress: true

on:
  schedule: "hourly"
  workflow_dispatch:
    inputs:
      target_repo:
        type: string
      safe_output_repo:
        type: string
      max_repos:
        default: 1
        type: number
      rollout_percent:
        default: 100
        type: number
      safe_output_mode:
        default: "review"
        type: choice
        options: [review]
      correlation_id:
        type: string
      central_repo:
        type: string
      control_plane_run_url:
        type: string
  permissions:
    contents: read
    actions: read

env:
  GH_AW_SAFE_OUTPUT_MODE: ${{ inputs.safe_output_mode || 'review' }}
  REVIEW_OUTPUT_REPO: ${{ inputs.safe_output_repo || github.repository }}
  SAFE_OUTPUT_REPO: ${{ (inputs.safe_output_mode || 'review') == 'review' && (inputs.safe_output_repo || github.repository) || '' }}
  TARGET_REPO: ${{ inputs.target_repo || '' }}

jobs:
  pre-activation:
    outputs:
      cao_authorized: ${{ steps.cao_admission.outputs.authorized == 'true' && steps.cao_precompute.outputs.authorized != 'false' }}
      cao_reason: ${{ steps.cao_precompute.outputs.reason || steps.cao_admission.outputs.reason }}

if: needs.pre_activation.outputs.cao_authorized == 'true'

imports:
  - uses: shared/control.md
    with:
      campaign: squad-advisory
      role: orchestrator
      read_repository: ${{ github.repository }}
      dispatch_max: 4
      orchestrator_credits: 250
      worker_credits_per_target: 150
      read_actions: read
      read_contents: read
      read_issues: read

permissions:
  contents: read
  actions: read
  issues: read
  copilot-requests: write

strict: true
network:
  allowed: [defaults, github]

tools:
  github:
    mode: remote
    toolsets: [repos, issues, actions]
  repo-memory:
    branch-name: "memory/squad-advisory"
    description: "Advisory dispatch timestamps and review issue identities; never source content or authority"
    file-glob: ["dispatches/*.json"]
    allowed-extensions: [".json"]
    format-json: true
    max-file-size: 4096
    max-file-count: 100
    max-patch-size: 16384

safe-outputs:
  dispatch-workflow:
    workflows: [squad-advisory-farm-snapshot]
    max: 4
  threat-detection: false

steps:
  - name: Require review-only Squad dispatch
    run: |
      node --input-type=module -e '
        import { readFileSync } from "node:fs";
        const envelope = JSON.parse(readFileSync("/tmp/gh-aw/agent/control-precompute.json", "utf8"));
        if (envelope.safe_output_mode !== "review") {
          throw new Error("Squad Advisory supports review dispatch only; no live work is authorized by this campaign");
        }
      '
---

# Squad Advisory

Select repositories and dispatch evidence collection only. Native Squad, installed
and reviewed independently in the control repository, owns casting, research,
triage, and farm-wide planning. Do not install it, imitate a fixed-roster Squad,
perform target research here, or dispatch implementation work.

Read `/tmp/gh-aw/agent/control-precompute.json` first. Its candidate repositories,
worker eligibility, review routing, modes, and effective limits are authoritative.
Read bounded advisory records from `$GH_AW_MEMORY_DIR` before selection. Missing
memory is not evidence of missing snapshots, and memory cannot authorize a target.

## Discovery

Use only the precomputed candidate batch. Never enumerate owners, organizations,
installations, or repositories referenced by target content. Farm identity and
enrollment come only from the control repository's reviewed policy; optional
`.github/cao/squad-advisory.md` may prioritize within that envelope, not extend it.

Rank candidates with no known snapshot first, then candidates with the oldest
snapshot or a changed default-branch revision. Use control-repository snapshot
issues and bounded dispatch memory for ranking only; do not read target source
content or reconstruct cross-repository relationships here. Defer a target with
a dispatch in the preceding 24 hours. Never describe deferred or inaccessible
targets as covered. Do not claim whole-farm coverage from one batch.

Select at most `effective_max_repos` targets and four total dispatches. If there
are no eligible review-mode candidates or the snapshot worker is disabled, call
`noop` with the specific reason. Do not change policy, credentials, enablement,
mode, or native Squad state to make a candidate eligible.

## Workers

`squad-advisory-farm-snapshot` prepares one bounded evidence snapshot for exactly
its dispatched target and proposes one issue in the authorized review repository.
It does not read the rest of the farm, write farm files, or dispatch further work.

Use the complete standard control-plane envelope and each target's resolved mode
and routing from shared control. Dispatch only review-mode target/worker pairs.
Deduplicate `(worker, target_repo, safe_output_mode)` tuples before dispatch.
Do not retry failed or rate-limited dispatches in this run.

Keep at most 100 advisory records in `$GH_AW_MEMORY_DIR/dispatches/`, each at most
4096 bytes, pruning the oldest first. Store only target identity, workflow,
requested time, and known review issue identity. A requested dispatch is not a
completed snapshot, accepted evidence, or native Squad research.

## Completion

Finish with the standard `## Orchestrator Report` inherited from
`shared/control.md`, preserving Scope, Repository Decisions, Workers, Dispatches,
and Outcome. Distinguish selected, deferred, skipped, failed, and incomplete
targets. Use exact precomputed totals, not a whole-farm coverage estimate.

{{#runtime-import? .github/cao/squad-advisory.md}}
