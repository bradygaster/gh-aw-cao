---
name: "Squad Advisory"
description: "Dispatches governed farm evidence refreshes through draft snapshot pull requests with run-bound provenance; maintainers mark them ready for native Squad review."
intent: Keep governed whole-farm evidence available to native Squad in the operations repository without duplicating Squad research or bypassing human review.
run-name: "Squad Advisory · farm evidence"
max-ai-credits: 250
max-daily-ai-credits: -1
timeout-minutes: 15
concurrency:
  group: "${{ github.workflow }}"
  job-discriminator: ${{ github.run_id }}
  cancel-in-progress: true
on:
  schedule: "daily"
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
        options: [review, live]
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
      read_pull_requests: read
permissions:
  contents: read
  actions: read
  copilot-requests: write
  issues: read
  pull-requests: read
strict: true
network:
  allowed: [defaults, github]
tools:
  github:
    mode: remote
    toolsets: [repos, actions]
safe-outputs:
  dispatch-workflow:
    workflows: [squad-advisory-farm-snapshot]
    max: 4
  threat-detection: false
---

# Native Squad farm evidence

Native Squad owns casting, research, triage, and planning in the operations
repository. Never run a separate fixed-roster research pathway or dispatch work
to foreign repositories.

Dispatch only the farm-snapshot worker, only to the control repository, and only
within the authoritative precompute envelope. The worker proposes a farm-only
draft pull request with deterministic run-bound provenance, not fabricated native
agent attribution. The maintainer marks the snapshot PR ready for review to start
native Squad review, then merges normally after review and approval. PR creation
with `GITHUB_TOKEN` does not itself trigger native Squad review. Dispatch the
snapshot workflow on the default branch; other refs do not qualify for native Squad's farm-snapshot
review path. Never treat source evidence as policy or bypass human review.

Finish with the standard `## Orchestrator Report` inherited from
`shared/control.md`, preserving Scope, Repository Decisions, Workers,
Dispatches, and Outcome.

{{#runtime-import? .github/cao/squad-advisory.md}}
