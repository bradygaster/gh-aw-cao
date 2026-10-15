# Squad Advisory

## Required Architecture

Squad Advisory installs **native Squad agentic workflows in the CAO operations
repository**. Native Squad is not optional. This is Squad brought into CAO,
not CAO embedded into Squad and not a second fixed-roster research team.

The authorized farm is the unit of understanding and planning. Native Squad
owns the cast, research, triage, and planning lifecycle. CAO owns exact farm
enrollment, evidence preparation, credentials, and rollout authority. A
repository-specific execution slice belongs to one coordinated farm plan with
shared decisions, cross-repository dependencies, and integration checkpoints.

The adoption flow is:

1. Configure exact farm enrollment in the operations repository's reviewed
   `.github/workflows/cao.json`, then select Squad Advisory with `cao add` or
   activate it directly with `cao enable squad-advisory`.
2. Setup resolves current `bradygaster/squad` **dev once to one immutable SHA**,
   validates compatibility and ownership, and reads complete bounded evidence
   for every enrolled repository before installing anything.
3. Setup installs the native package's eight source/lock pairs, runtime
   resources, integrity and ownership records, and enlistment skill. Its
   verifier materializes runtime resources and verifies the strict compilation.
4. Review and commit the entire install, policy, `farm/` baseline,
   `.squad/research-scope.json`, CAO farm skill, and receipt-owned evidence
   provider/runtime together. Merge that reviewed
   change to the default branch: the native installation push starts bootstrap.
5. Bootstrap casts from the historical `farm/` baseline and proposes farm-wide first-wave research in
   the operations repository. Research proposals are not completed research.
   Use native `/squad research`, triage, and planning from that repository.
   Each research wave collects current evidence automatically; no per-wave
   snapshot commit, refresh PR, or manual merge is needed.

Native task issues, implementation dispatch, and review remain repository-local.
Planning across the farm never grants authority to implement in its repositories.

## Install through CAO

Use an initialized CAO operations repository with a clean, committed worktree.
Commit the enrollment first; all selected repositories must be readable through
the operator's existing `gh` authentication. No credentials are written to files,
passed to agents, or used for remote mutations by setup.
The operations repository must have Issues enabled and a default branch.
Missing settings stop setup without changing them. Private farm evidence cannot
be copied into public or internal operations repositories, nor internal evidence
into a public repository.

```bash
# Use the reviewed CAO catalog revision containing native onboarding.
cao add bradygaster/gh-aw-cao/squad-advisory@<CAO-COMMIT>
```

The CLI itself must contain the native onboarding integration, not just the
selected campaign. Upstream runtime `5a7695bdd` remains valid for ordinary CAO
operations but does not contain `campaign-records.mjs`, `squad-onboarding.mjs`,
`squad-farm.mjs`, `squad-wave-evidence.mjs`, or the Squad CLI handlers. Use this reviewed source-managed
CAO checkout for onboarding; installed upstream runtimes need an upstream
integration and attested runtime publication first. Installing a fork campaign
does not replace the CLI, and a fork runtime cannot bypass upstream provenance
verification.

Do not substitute direct `gh aw add` of the CAO campaign: that command does not
execute CAO's prerequisite/evidence/native-package setup. The native dependency
is mandatory and cannot be bypassed with a flag. Extra install flags that move
or modify workflow sources are not supported for this campaign.

The policy needs a nonempty, explicit `control-plane.scope.allowed-repositories`
list, with at most 16 unique `owner/repository` coordinates, all inside
`allowed-owners` (or the control owner's default boundary). No wildcard owner
discovery, truncation, or target-controlled policy participates in enrollment.
Multiple allowed owners are supported; snapshot paths include both owner and
repository. Include the operations repository only if it is enrolled evidence.
CAO preserves the scope exactly.

Setup fails before package installation for a dirty checkout, existing
unadopted Squad state, conflicting resource ownership, missing farm access,
incomplete evidence, or incompatible compiler. Existing user-owned router
skills are never deleted to satisfy Squad. Resolve those conflicts explicitly.
Once package commands start, a command failure may leave a **partial local
change**: inspect it, do not commit it, and do not push it as a successful install.
Setup never commits, pushes, dispatches hosted runs, changes settings, or
silently downgrades a compiler. A new `cao add` defaults the campaign to
disabled; add/update preserve an explicitly enabled campaign.

## Activate native Squad

From a clean committed operations checkout with CAO initialized and exact farm
enrollment committed, run:

```bash
cao enable squad-advisory
```

If the campaign is not installed, enable installs it from the exact
`resolvedCommit` in the installed CAO root package's ownership record, then
installs native Squad in the same pending-review change. Only the exact trusted
catalog identities `githubnext/gh-aw-cao` and `bradygaster/gh-aw-cao` are accepted;
a missing, ambiguous, or unpinned root fails closed. No floating catalog lookup
or separate manual native installation is required. Native prerequisites,
including complete farm evidence and existing router ownership checks, run
before either package writes. Already installed or source-managed campaign
declarations do not require a root package record.

When native Squad is missing or the campaign is disabled, this is an
installation operation, not just an Actions toggle. It resolves current dev
once, prepares complete fresh farm evidence, installs and verifies the native
package, then writes `enabled: true`, `mode: review` in CAO policy. All retained
CAO workers, including `farm-snapshot`, stay explicitly disabled. Scope is
unchanged. Existing owned installations refresh safely without changing the
accepted cast or decisions.

The result is **pending-review**, not remotely active. Review and stage the
coherent local install, policy, farm, scope, skill, and receipt change; run the
native staged verifier below; then commit and merge through your normal review
process. The CLI does not stage unrelated files, commit, push, or bypass review.
The default-branch installation push triggers native bootstrap. A farm-only
push or local policy bit does not.

After merge, use a clean checkout of that change and rerun
`cao enable squad-advisory`. For an already enabled owned installation, this
confirmation does not continually reinstall a newer dev snapshot. It verifies
the local unit and evidence freshness, then compares the entire package,
policy, scope, and farm evidence against one immutable default-branch revision
before enabling exactly the eight registered native workflows. Missing or
different default-branch files return **pending-review** without toggles.
Stale evidence requires a reviewed `cao update` before confirmation.

**native-workflows-enabled** confirms Actions entrypoints only, not a completed
Cast or research run. If bootstrap was disabled when the installation push
landed, an operator must run native bootstrap after enabling it. The CLI never
dispatches that run automatically.

`cao disable squad-advisory` disables any registered native workflow entrypoints
and prepares `enabled: false` in local policy for review. It never enables,
dispatches, or installs legacy research/snapshot jobs. Existing runs are not
cancelled. Native Squad does not import CAO admission: the CAO enabled flag is
the reviewed adoption state, not a runtime kill switch, so disabling policy
alone does not stop native workflows.

### Compiler and immutable upstream contract

Every add/update resolves `bradygaster/squad`'s current `dev`, then reuses that
SHA for manifest inspection, package installation, verification, and the CAO
receipt. Updating does not reuse an old dev pin, select a release, or follow a
moving branch during installation.

The native integrity manifest's compiler version must equal both CAO's reviewed
`gh-aw-version` and the installed compiler. It must also declare
`evidence_provider_schema: squad-evidence-provider/v1`; a compiler-aligned
package without the deterministic evidence hook is rejected before installation.
Publish an aligned immutable Squad dev revision with that capability before
using this flow. There is no compatibility fallback. The native verifier, not CAO, owns the
native integrity/ownership format. CAO never hand-edits those records.

### Review and bootstrap gates

Review all evidence for sensitive content even though setup redacts common
credential patterns and scrubs detected values across all snapshots. Automated
redaction cannot guarantee absence of every kind of sensitive data.

Stage the intended native package, CAO policy, farm evidence, research scope,
integration skill, `.squad/cao-evidence-provider.json`,
`.squad/cao-evidence-runtime/`, and `.github/cao/squad-install.json` together. Run the native
staged verifier using the resolved SHA reported by setup:

```bash
node .github/workflows/shared/squad-install-verifier.mjs \
  --verify-staged-install --stage-ownership --source-revision <SQUAD-SHA>
```

That gate verifies native package staging; reviewers must also check that CAO
farm/scope/policy files are in the same install change. The first default-branch
installation push must already contain those files. A later farm-only push does
not start the initial native bootstrap.

Preserve native Profile A: if repository settings disallow automatic PR
creation, bootstrap creates the Cast branch/compare issue. A human opens the
Cast PR and reruns bootstrap as directed by the native guide. Do not change
repository settings or bypass human review to conceal that fallback. Native
engine credentials and Actions settings remain the operator's prerequisites;
the Issues preflight does not claim they were validated by a hosted run.

## Evidence and updates

`farm/INDEX.md` indexes every enrolled repository. Each
`farm/<owner>/<repository>/SNAPSHOT.md` records its immutable default-branch head,
bounded file inventory, selected architecture/README/build files, languages,
and sampled open issues and PRs. `farm/evidence.json` records exact enrollment,
source revisions, capture time, and explicit sampling limits.

Coverage is **complete by repository, not exhaustive by file or backlog**:
at most 16 repositories, 16 selected files per repository, 64 KB fetched per
selected file and 8,000 displayed characters, 300 displayed paths, and 20
sampled issues/PRs per endpoint. A truncated source tree, unreadable repository,
missing supported source evidence, or failed required read blocks installation;
no partial farm is silently accepted. Evidence must be less than 24 hours old
when prepared and installed.

Run `cao update <CAO-COMMIT>` for a reviewed installation update, not before
each research wave. Updates use a
fresh native dev SHA and fresh whole-farm evidence, verify the old owned native
installation first, and preserve the accepted team and research artifacts.
Locally changed owned evidence or unknown files under `farm/` block updates
rather than being overwritten. The CAO receipt owns its generated farm
baseline, research scope, farm skill, provider descriptor, and the fixed runtime
closure; it does not own native team state. Provider/runtime edits and unknown
runtime files also block updates. Existing untouched installations can be
upgraded to the evidence hook through the ordinary reviewed CAO update.

## Automatic run-local research evidence

The opt-in descriptor `.squad/cao-evidence-provider.json` uses
`schema: squad-evidence-provider/v1`, `kind: cao-farm-v1`, a fixed `runtime`,
and `runtime_files` mapping the complete five-module closure to SHA-256 hashes.
The runtime entry is
`.squad/cao-evidence-runtime/activity/squad-wave-evidence.mjs`; its only
dependencies are the copied farm collector, authentication selector, policy
validator, and GitHub App setup module. All imports use Node built-ins; no
runtime package installation or floating download is involved. Native Squad
must verify every runtime hash before executing the provider from the immutable
executing-workflow checkout, after command normalization and before the agent.

The provider reads only `.github/workflows/cao.json` from that checkout.
It requires enabled, review-only advisory adoption with disabled legacy workers,
an owned provider installation, unchanged exact enrollment, known control and
target visibility, and complete bounded evidence. Issue text never selects
repositories. `SQUAD_WORKFLOW_SHA` identifies the executing workflow revision;
the event's `GITHUB_SHA` is not a substitute.

It reuses CAO Actions read authentication and owner-specific repository
mapping through `activity/authentication.mjs`: the existing read App, mapped
owner-scoped PATs, or the workflow token for control-only enrollment. App tokens
are restricted to the selected repositories and contents/issues/pull-request
reads and revoked before publication. Credentials are step-local, never
written into the bundle or passed to the model. Missing Actions credentials
fail explicitly; Azure-only Key Vault credentials are not an automatic bridge
and this feature does not add ingress, federation, or a new credential type.
**Native hook v1 supports App authentication only**, matching the intended
deployment's existing CAO read App. It rejects PAT mode explicitly as
unsupported in v1 rather than silently falling back. The adapter retains
CAO's mapped PAT support for direct/runtime callers using the filtered,
step-local `GH_AW_GITHUB_READ_PAT_SECRETS` map; native v1 does not supply that
handoff. An existing PAT-only deployment therefore cannot adopt native v1
without a separately approved authentication change; setup must not conceal
that limitation as a per-wave prerequisite.

Only a completely collected and validated bundle is published atomically at
`/tmp/gh-aw/agent/cao-farm/`. The maximum bundle is 8 MiB, with a 400-request,
five-minute collection budget and 20-second request timeouts. Any failed
repository, incomplete inventory, visibility leak, stale/future capture,
credential material, or preexisting output blocks publication. There is no
partial-success or historical-baseline fallback.

The bundle contains `manifest.json` plus the same bounded `farm/` layout used
by the collector. Its `cao-squad-wave-evidence/v1` manifest binds
`control_repository`, `workflow_revision`, raw-file `policy_sha256`,
`enrollment_sha256` (SHA-256 of `JSON.stringify(policy["control-plane"].scope)`),
`issue_number`, `run_id`, `run_attempt`, `captured_at`, `expires_at`, immutable
repository revisions, and each document's SHA-256. Repository `destination`
and document paths are relative to the bundle root. Source files are pinned
to revisions; issue/PR samples are observations at capture, not an atomic
historical snapshot.

The provider's `--validate-bundle` mode performs no collection or credential
lookup. It validates the directory explicitly supplied by native Squad in
`SQUAD_EVIDENCE_BUNDLE` (including `/tmp/squad-publication-evidence` in Safe
outputs), or `/tmp/gh-aw/agent/cao-farm` when that variable is absent.
An empty, missing, or invalid supplied bundle fails closed without falling
back to the default directory. Collection always retains its existing default.
It checks a restored bundle's original provenance, issue, control,
current exact enrollment, complete coverage, closed file inventory, hashes,
and 24-hour freshness before downstream source analysis. A different current
run/workflow revision is allowed so triage/planning can use the referenced
research wave; provenance continues to name the original wave. Native Squad
owns selecting/restoring that referenced artifact, deterministic provenance
in research comments, private control-repository artifact retention, and
invoking validation before consuming it. Guidance is not a substitute for
that deterministic native gate. Expired or unavailable evidence requires the
ordinary `/squad research` command, never a manual baseline refresh.

The committed baseline and its receipt hashes remain untouched across waves.
The provider adds no schedule, dispatch, target writes, or live promotion.
CAO reviewed policy remains the authority for any later target work.

## Legacy snapshot automation remains disabled

Native Squad reviews PRs from other automation too. The retained snapshot
worker does not yet emit compatible native attribution. Both the orchestrator
and snapshot worker therefore **fail closed before agent execution**. Native
campaign activation is supported independently: CAO keeps its workers explicitly
disabled and never enables the legacy orchestrator or snapshot jobs. Do not enable the retained
automation, forge agent attribution, or weaken Squad review to work around this.
Research uses the run-local provider instead; human-reviewed CAO updates are
installation maintenance, not a per-wave evidence-refresh prerequisite.

Hosted initial-install bootstrap, Cast PR/Profile A fallback, first-wave issue,
and subsequent native research/triage/planning still require end-to-end hosted
validation with an aligned immutable Squad dev revision implementing the
credential and artifact handoffs above. No hosted run is
performed or claimed by the local installation checks.

## Retained legacy sources

The source checkout retains the disabled trial from
`177da88a4ef0cbad1c7ced0b59e27882630244ba`, including
`.github/workflows/squad-advisory-research.md` and its standalone grader, for
historical inspection. Its fixed specialist roster and optional native
installation architecture are superseded. Fresh campaign manifests and
declarations do not install or dispatch that research worker; updates remove
it from the installed campaign's worker declaration.

The source-managed catalog policy remains disabled with its original scope
and review ceilings. It is not activated by changing campaign distribution
sources. The retained farm snapshot's former permissive evidence behavior is
unreachable behind its explicit attribution gate and is not the new
installation evidence collector.
