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
   `.github/workflows/cao.json`, then select Squad Advisory with `cao add`.
2. Setup resolves current `bradygaster/squad` **dev once to one immutable SHA**,
   validates compatibility and ownership, and reads complete bounded evidence
   for every enrolled repository before installing anything.
3. Setup installs the native package's eight source/lock pairs, runtime
   resources, integrity and ownership records, and enlistment skill. Its
   verifier materializes runtime resources and verifies the strict compilation.
4. Review and commit the entire install, policy, `farm/` evidence,
   `.squad/research-scope.json`, and CAO farm skill together. Merge that reviewed
   change to the default branch: the native installation push starts bootstrap.
5. Bootstrap casts from `farm/` and proposes farm-wide first-wave research in
   the operations repository. Research proposals are not completed research.
   Use native `/squad research`, triage, and planning from that repository.

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
Setup never commits, pushes, dispatches hosted runs, changes settings, enables a
campaign, or silently downgrades a compiler.

### Compiler and immutable upstream contract

Every add/update resolves `bradygaster/squad`'s current `dev`, then reuses that
SHA for manifest inspection, package installation, verification, and the CAO
receipt. Updating does not reuse an old dev pin, select a release, or follow a
moving branch during installation.

The native integrity manifest's compiler version must equal both CAO's reviewed
`gh-aw-version` and the installed compiler. Native dev
`477f583b3a239e9a3b59d059d7604875086c56b7` requires `v0.89.22`, so it is rejected
by CAO `v0.91.5`. Publish the aligned Squad dev revision before using this flow.
There is no compatibility fallback. The native verifier, not CAO, owns the
native integrity/ownership format. CAO never hand-edits those records.

### Review and bootstrap gates

Review all evidence for sensitive content even though setup redacts common
credential patterns and scrubs detected values across all snapshots. Automated
redaction cannot guarantee absence of every kind of sensitive data.

Stage the intended native package, CAO policy, farm evidence, research scope,
integration skill, and `.github/cao/squad-install.json` together. Run the native
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

Run `cao update <CAO-COMMIT>` for a reviewed local refresh/update. Updates use a
fresh native dev SHA and fresh whole-farm evidence, verify the old owned native
installation first, and preserve the accepted team and research artifacts.
Locally changed owned evidence or unknown files under `farm/` block updates
rather than being overwritten. The CAO receipt owns only its generated farm
evidence, research scope, and farm skill; it does not own native team state.

The durable `.squad/skills/cao-farm/SKILL.md` instructs later native operations
to recheck freshness, enrollment, and farm-wide dependencies. Native later
research does not universally enforce scope or freshness in code: this is
integration guidance, not a new security boundary. Recheck evidence before
starting a later research wave; use CAO policy for all target authority.

## Automated refresh is not yet available

Native Squad reviews PRs from other automation too. The retained snapshot
worker does not yet emit compatible native attribution. Both the orchestrator
and snapshot worker therefore **fail closed before agent execution**, and CAO
setup leaves the campaign disabled and review-only. Do not enable the retained
automation, forge agent attribution, or weaken Squad review to work around this.
The supported refresh path is a human-reviewed local CAO update.

Hosted initial-install bootstrap, Cast PR/Profile A fallback, first-wave issue,
and subsequent native research/triage/planning still require end-to-end hosted
validation with an aligned immutable Squad dev revision. No hosted run is
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
