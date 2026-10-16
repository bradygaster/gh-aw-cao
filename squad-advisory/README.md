# Squad Advisory

An experimental, review-only CAO catalog campaign that prepares bounded evidence
for an independently installed native Squad. CAO selects policy-authorized
repositories; one worker proposes one repository snapshot as a review issue.
Humans verify the snapshots before native Squad uses them for farm-wide casting,
research, triage, or planning.

## Package boundary

Install this package through the ordinary `cao add` campaign path in an already
initialized control repository, using a reviewed immutable catalog revision:

```sh
./cao.sh add OWNER/CATALOG/squad-advisory@COMMIT
```

Replace the package coordinate with the selected catalog and commit. The
descriptor and workflow inventory are self-contained; this package does not
reinstall the root control plane or replace the CAO CLI/runtime. It needs no
Squad-specific materializer, `cao enable` handler, onboarding hook, or credential
resolver. Adding it does not install, activate, or validate native Squad.
The root catalog manifest does not install operational campaigns by default.

Deployment owner, repository, farm, and App identities belong to the control
repository's configuration, never to campaign source. Use reviewed
`.github/workflows/cao.json` for authority, `.github/cao/squad-advisory.md` for
optional priorities within that authority, and the existing Actions variables
and secrets for authentication. Steering and target files cannot enroll targets
or grant permissions.

This source change registers Squad Advisory in the catalog repository's rollout
policy with both campaign and worker explicitly disabled and review-only.
It does not change repository scope or any existing campaign. Publishing a
package is not activation. An operator must separately review installation and
policy before any run. No installation, dispatch, deployment, or downstream
rollout is part of this change.

## Authority and output

The orchestrator imports standard shared control, ranks only its precomputed
candidate batch, reads bounded advisory memory, and dispatches at most four
`farm-snapshot` workers within the effective target limit. A worker receives
the full standard dispatch envelope and uses the shared target-scoped read
credential for exactly its dispatched repository. There is no whole-farm token,
owner discovery, multi-target worker, or implementation dispatch.

Keep the installed campaign disabled until an operator has reviewed the
ordinary installation, exact scope, credentials, and review destination.
An example campaign policy fragment, inside `control-plane.campaigns`, is:

```json
{
  "squad-advisory": {
    "enabled": false,
    "mode": "review",
    "max-repositories": 1,
    "workers": {
      "farm-snapshot": {
        "workflow": "squad-advisory-farm-snapshot",
        "enabled": false,
        "max-mode": "review"
      }
    }
  }
}
```

This fragment grants no repository scope. Enrollment remains in the existing
global policy. Do not widen it merely to make the campaign run.
Both workflows reject live mode before agent execution. The worker retains
shared control's human-only, staged debug path; debug is not rollout authority.
Read permissions cover contents, Actions, issues, and pull requests as declared
by each workflow. Authentication remains the existing shared App, owner-scoped
PAT, or workflow-token profile; no local fallback profile is introduced.

**Dispatch portability blocker:** the worker retains the exact upstream
Repo Assist `on.bots` convention required by the existing CAO contract tests.
That allowlist names the standard Actions bot and upstream's write App bot.
A different control repository's write App bot is not covered by this allowlist;
do not claim that its dispatch will activate the worker. No variable expression,
broader role allowance, deployment-specific identity, or core-contract change
is introduced to work around this mismatch. A supported upstream dispatch-bot
configuration contract is required before rollout with a different write App.

The only mission-specific durable output is one deduplicated issue in the
authorized review repository, with a 14-day expiration and a canonical subject
containing the exact target identity. An existing open snapshot causes a no-op,
not an update or another issue. Expiration bounds abandoned proposals, but is
not a freshness assertion. A worker may not close another target's evidence.
Repo-memory contains advisory dispatch metadata only, never raw source or
authority.

## Evidence and native Squad handoff

Snapshots summarize a bounded tree, at most 16 documentation/build files,
20 issues, and 20 pull requests from one repository. Source reads use one
immutable default-branch SHA; mutable backlog evidence has a capture timestamp.
No source code is executed and no raw files are mirrored. Unknown access,
visibility, or required evidence is reported incomplete. Private evidence may
not move to a less restrictive review repository.

The farm is understood by humans and native Squad from the set of reviewed,
fresh target snapshots, not by granting one worker access to every repository.
Coverage must be checked against the current exact enrollment; missing,
deferred, expired, inaccessible, or stale snapshots remain explicit gaps.
Revalidate evidence older than 24 hours before planning.

Native Squad must be installed through its own reviewed, compiler-compatible
package process. Package coordinates and immutable revisions are chosen in
control-repository configuration, not baked into this campaign. Native Squad
owns its installation receipts, cast, research state, review attribution, and
implementation authority.

This package does **not** automatically install native workflows, write
`farm/` or `.squad/`, reconcile existing installation receipts, bootstrap a cast,
or run native research. In particular, it does not replace the old blocked
farm-file refresh with an unattributed PR. Those behaviors need a supported
native package handoff and review-attribution contract; an ordinary CAO campaign
cannot claim that integration by patching core or hand-editing ownership data.
Existing Squad-owned farm files must remain untouched until their owning
package can reconcile changes safely.

## Operational value

The intended outcome is more accurate farm-wide planning from fresh,
reviewed repository evidence. It is **not measurable yet**: no deterministic
contract currently maps an eligible planning opportunity to accepted,
correct native Squad decisions. Snapshot counts, issue creation, run success,
and human engagement are mechanism proxies, not outcome attainment. The
campaign therefore ships no operational-value evaluator or worker evals and
claims neither completed research nor measured planning improvement.

## Local validation

From the catalog checkout:

```sh
gh aw compile .github/workflows/squad-advisory.md \
  .github/workflows/squad-advisory-farm-snapshot.md \
  --strict --no-check-update --schedule-seed githubnext/gh-aw-cao
node --test tests/unit/workflow-contract-squad-advisory.test.mjs \
  tests/unit/workflow-contract-campaigns.test.mjs
```

The lock files are compiler-generated. Installation and authenticated live
execution are separate operator-approved actions, not local authoring checks.

The initial compiler review warnings list the standard shared-control secret
references `GH_AW_GITHUB_READ_APP_PRIVATE_KEY`, `GH_AW_GITHUB_READ_PAT`,
`GH_AW_GITHUB_WRITE_APP_PRIVATE_KEY`, and `GH_AW_GITHUB_WRITE_PAT`. These are
inherited authentication references, not new credential profiles or values.
The generated actions are the existing pinned shared-control/gh-aw actions;
this campaign adds no external action, installer, or credential-export step.
Review those references as part of ordinary package installation.
