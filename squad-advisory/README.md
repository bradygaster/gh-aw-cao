# Squad Advisory

## Required Architecture

Squad Advisory must install and use **native Squad agentic workflows in the CAO
operations repository**. Native Squad is not an optional enhancement, and the
campaign must not replace it with a separate, Squad-like research team.

The entire authorized farm is the unit of understanding and planning.
Repository-specific work is an execution slice of a coordinated farm plan,
including cross-repository dependencies, shared decisions, and integration
checkpoints. CAO supplies governed farm evidence and rollout authority; the
integration reuses Squad's existing team, research, triage, and planning
capabilities rather than rebuilding them.

The required adoption flow is:

1. A user configures a farm and selects the Squad Advisory campaign.
2. Campaign setup installs native Squad workflows into the operations
   repository and prepares the authorized farm context for their first run.
3. Installation activates Squad's normal bootstrap lifecycle, preserving its
   installation and human-review gates.
4. Bootstrap examines the farm context, proposes the cast in a pull request
   against the operations repository, and opens an issue proposing the first
   wave of farm-wide research. Research proposals are not completed research.
5. Users operate Squad's native research, triage, planning, and subsequent
   lifecycle features from the operations repository for the farm.

This is **Squad brought into CAO**, not CAO embedded into Squad. Campaign setup
owns farm policy, evidence preparation, and the integration. Any necessary
Squad changes should be reusable capabilities, not CAO-specific dependencies.
Users must not need a separate, optional Squad adoption exercise after
selecting this campaign. Installation does not bypass human review or confer
additional authority to mutate farm repositories.

### Native Squad Capabilities Already Available

Source inspection on 2026-10-09 used
[`bradygaster/squad@477f583b3a239e9a3b59d059d7604875086c56b7`](https://github.com/bradygaster/squad/tree/477f583b3a239e9a3b59d059d7604875086c56b7).
This is an evidence baseline, not a designated consumer installation pin.

- Bootstrap already accepts committed `.squad/research-scope.json` with
  `schema: "squad-research-scope/v1"` and `evidence_roots: ["farm/"]`. It casts
  specialists for that evidence rather than the hosting infrastructure.
  Authorized snapshots and scope must be ready before the initial cast.
- Native Squad supplies durable team identities and routing, research
  artifacts, work/decision/excluded triage, program and implementation plans,
  dependency-aware phases, validation, explicit acceptance and activation,
  local implementation workers, independent review, and retrospectives.
- At this revision, bootstrap publishes the Cast and research proposals;
  `/squad research` explicitly begins research. The earlier `v1.0.1` release
  still seeded a research comment, so release selection affects this behavior.
- Farm reasoning does not imply foreign-repository execution. Native task
  issues, implementation dispatch provenance, and review are repository-local.
  CAO must preserve fleet authority when translating accepted work and
  collecting completion evidence across repositories.
- Package coexistence needs an explicit solution: the native installer and
  verifier require gh-aw `v0.89.22`, while this CAO revision validates all
  workflow locks using `v0.91.5`. Recompiling native Squad with another version
  is not established as compatible.
- Native Squad review applies to same-repository PRs, including those created
  by other automation. CAO snapshot PRs need compatible attribution; installing
  Squad alone does not satisfy its review contract.

The sources retained below are the **legacy trial implementation**, not an
implementation of this required architecture. They remain disabled. Their
fixed advisory roster and optional native-Squad installation path are
superseded design choices; they are documented here to explain the imported
code, not to recommend retaining that split.

## Retained Trial Implementation

> [!NOTE]
> **Experimental campaign:** The squad roster, triage buckets, and output contract may change as review evidence accumulates.

This fork retains the campaign from `squad-advisory-trial` at commit
`177da88a4ef0cbad1c7ced0b59e27882630244ba`. Its workflow behavior is preserved,
with the manifest and generated workflows aligned to the current CAO compiler.
The source-managed policy registers it with `enabled: false` and review-only
worker ceilings. Copying the sources does not activate the campaign or change
the existing repository scope.

Squad Advisory gives repository owners an answer to the question they rarely have time to ask: *what should we actually do next here?* One standing advisory squad lives in the control repository. Its orchestrator selects a repository that has no current plan, and its worker convenes that squad against exactly that repository — five specialists research it in parallel, a fact checker tests every claim, a responsible-AI reviewer flags what is risky to automate, and the coordinator publishes one triaged, decision-ready plan.

## The squad lives here, not there

The squad is **owned by the control repository** and defined at compile time. It is not cast per target, and it is never derived from anything found in a target repository.

That is a safety property, not a convenience. A squad assembled from a target repository's own content would let that repository choose who reviews it. Instead the roster is checked in, reviewed, and identical for every target; target content — including a `.squad/` directory if one exists — is untrusted evidence only.

| Member | Perspective |
| --- | --- |
| `squad-architect` | Structure, boundaries, coupling, accumulated design debt. |
| `squad-security` | Supply chain, dependency hygiene, workflow permissions, disclosure readiness. |
| `squad-reliability` | Test signals, CI health, failure patterns, release confidence. |
| `squad-dx` | Contributor and agent experience, documentation, issue and pull request hygiene. |
| `squad-product` | Backlog themes, unmet intent, divergence between stated purpose and recent activity. |
| `squad-fact-checker` | Tests every finding against the evidence and rejects unsupported claims. |
| `squad-rai` | Flags recommendations that carry risk if applied automatically. |

The five specialists run in parallel. The fact checker and the responsible-AI reviewer run afterwards, on the specialists' output.

## Campaign Contents

| Workflow | Responsibility |
| --- | --- |
| [`squad-advisory`](../.github/workflows/squad-advisory.md) | Daily and manually dispatchable orchestrator that selects a repository lacking a current plan and dispatches the campaign worker. |
| [`squad-advisory-research`](../.github/workflows/squad-advisory-research.md) | Convenes the standing squad against one repository and files one issue containing a triaged plan. |
| [`squad-advisory-farm-snapshot`](../.github/workflows/squad-advisory-farm-snapshot.md) | Targets only the control repository. Proposes one pull request that refreshes `farm/`, a bounded and redacted read-only mirror of every farm repository, so a real Squad installed in the control repository can cast and research across the whole farm. |

Workers are independently dispatchable and handle exactly one authorized target repository. Review mode routes findings to the control repository; live mode may open the equivalent issue on the target repository.

## Covering the whole farm: The "First Big Rock" and Cyclical Cadence

The squad lives in the control repository, but its mission is the whole farm. In a multi-repository system, individual repositories do not exist in a vacuum — a frontend change requires backend API updates, an ASMX service modernization impacts queue workers, and Docker Compose configurations link multiple checkouts together.

The campaign operates across two complementary advisory roles in a continuous, cyclical cadence:

### 1. The First Big Rock — Farm Portfolio Advisory

When deployed across a farm, the campaign's very first action is to evaluate the control repository / operations hub. Instead of treating an operations repo as "just configuration," the standing Squad uses the control plane's allowed repository scope (`cao.json`) to survey the entire farm.

Like the initial research-proposals issue in Squad agentic workflows, the Squad maps the component topology, surfaces cross-cutting architectural bottlenecks, and publishes a single, decision-ready issue in the ops repo: **The Top 3 Initiatives Across All Repositories**. This gives engineering leadership and maintainers immediate clarity on the macro priorities across their entire portfolio before diving into component-level details.

Before the agent starts, a deterministic pre-fetch step reads a bounded snapshot of each allowed repository (at most 16): metadata, languages, top-level entries, and excerpts of key files such as `README.md`, `docker-compose.yml`, `Dockerfile`, and build manifests. When the target is the control repository itself and GitHub App authentication is configured, the worker mints a separate read-only App token (`contents: read`, `metadata: read`) limited to the same-owner repositories listed in the control repository's own `cao.json` `allowed-repositories`. Only the pre-fetch script uses that token; the agent never receives it. The read App must be installed on those repositories. In PAT mode, or when the token cannot be minted, reads fall back to the worker's target-scoped credential, and farm repositories it cannot reach appear as evidence gaps rather than being guessed at.

### 2. Component Sweeps Aligned to the Farm Top 3

Following the portfolio advisory, the orchestrator advances through the component repositories one by one on its daily schedule. 

When advising a component repository, the worker checks the safe-output repository for the active Farm Portfolio Advisory. It aligns its recommended work so that local improvements — testing, dependency hygiene, refactoring — directly advance the farm's Top 3 Initiatives.

### 3. Cyclical Farm Reassessment

Once all component repositories in the farm have been advised, the cycle returns to the control repository (after a 14-day reassessment window). The Squad reconvenes on the entire farm to measure what has shipped, retire completed initiatives, identify new systemic friction, and publish a refreshed portfolio plan.

Coverage comes from cadence rather than simultaneous fan-out: the orchestrator runs daily with a default `max-repositories: 1`, prioritizing the farm hub first, sweeping the components, and then cyclically re-assessing the farm. A four-repository farm completes its initial portfolio and component sweep in four to five days and then enters its reassessment cadence.

## Bringing a real Squad to the farm

The built-in squad above is a fixed, compile-time roster. To have [Squad](https://github.com/bradygaster/squad)'s own agentic workflows cast a team and research the farm, install Squad in the **control repository**. Squad's bootstrap analyses the repository it is installed in, so the campaign first gives that repository a view of the whole farm.

1. **Farm snapshot.** Whenever the control repository is an eligible candidate, the orchestrator also dispatches `squad-advisory-farm-snapshot`.
   - Deterministic steps read each same-owner repository in `allowed-repositories` with the farm-scoped read App token.
   - They write `farm/INDEX.md` plus one `farm/<repository>/SNAPSHOT.md` per repository. The index is deliberately not named `README.md`, which gh-aw treats as a protected file. Each snapshot holds metadata, languages, the file tree, key files, a few representative source files, recent commits, open issues and pull requests, and recent workflow runs.
   - Credential-like values are redacted, and any value redacted once is scrubbed from every snapshot.
   - The agent only checks the diff and proposes it through one `create-pull-request` safe output restricted to `farm/**`. It declines when a snapshot pull request is already open or nothing changed.
2. **Merge the snapshot pull request** after confirming that no credential values appear.
3. **Install Squad in the control repository** by following the [Squad GitHub Agentic Workflows quick start](https://bradygaster.github.io/squad/docs/guide/gh-aw/). For example, ask a coding agent in the control repository to set it up according to that guide. The quick start ends at a human-reviewed install pull request.
4. **Merge the install pull request.** Squad's bootstrap then casts a team for the farm as a draft Cast pull request in the control repository, and files its `[Research Proposals]` issue. Both cite `farm/...` paths as evidence.

Later campaign runs refresh `farm/` through new snapshot pull requests, so `/squad research` and other Squad commands keep working from current farm evidence. Target repositories are never changed.

> [!IMPORTANT]
> Squad pins its own gh-aw compiler version and verifies the exact bytes of its compiled `.lock.yml` files. CAO validation recompiles every workflow source with the CAO compiler version and schedule seed, so it reports Squad's lock files as stale. Do not recompile Squad's workflows to satisfy CAO validation; Squad's install verifier would reject the result. Expect those Squad-owned findings until the two toolchains share a compiler version.

## What the plan contains

The worker's output is triaged, because an undifferentiated list of ideas is not a plan:

- **Recommended work** — at most seven items the owners could act on now, grouped into at most three ordered phases, with the single highest-return starting point named.
- **Decisions needed** — at most four choices only the owners can make, each with its options, costs, and the evidence that would settle it. The squad never decides for them.
- **Excluded** — at most five things considered and deliberately set aside, with the reason.

The issue also carries the evidence the plan rests on, each member's perspective with the fact checker's verdicts, and one ready-to-run agent prompt for the starting item.

## Recommending Squad itself

Squad can also run natively inside a repository, where maintainers drive it with `/squad` issue commands. That install is a per-repository choice: it adds eight agentic workflows, needs a human-reviewed bootstrap pull request, and requires repository settings changes only an administrator can make.

This campaign therefore never installs Squad anywhere. Installing Squad in the control repository, as described in [Bringing a real Squad to the farm](#bringing-a-real-squad-to-the-farm), is also a reviewed human decision. When the worker finds no `squad.md` or `squad-bootstrap.md` in a target repository, it raises enlistment as a **decision** for the owners, pointing at the [Squad GitHub Agentic Workflows quick start](https://bradygaster.github.io/squad/docs/guide/gh-aw/) and supplying the instruction to hand a coding agent. Whether to accept stays with the repository's owners.

## Install

Install the campaign into a Central Agentic Ops control repository:

```bash
gh aw add bradygaster/gh-aw-cao/squad-advisory@squad-advisory-trial
```

This command installs the retained trial revision, not unpublished changes in
this working branch. The custom campaign is not assumed to exist upstream.

The campaign is runnable after credentials, when needed, and checked-in policy are configured.

## Configure

Declare the campaign in `.github/workflows/cao.json`:

```json
{
	"version": 1,
	"control-plane": {
		"campaigns": {
			"squad-advisory": {
				"mode": "review",
				"max-repositories": 1,
				"workers": {
					"research": { "workflow": "squad-advisory-research", "max-mode": "review" },
					"farm-snapshot": { "workflow": "squad-advisory-farm-snapshot", "max-mode": "review" }
				}
			}
		}
	}
}
```

The omitted fields default to an enabled campaign and worker and 100 percent rollout. Set shared owner and repository boundaries under `control-plane.scope`.

## Validate in review mode

1. Open the generated **Squad Advisory** workflow in the control repository's **Actions** tab.
2. Select **Run workflow**.
3. Leave `target_repo` blank to discover an eligible repository, or set it to one fully qualified `owner/repository` name.
4. Keep `max_repos` at `1` and `safe_output_mode` at `review`.
5. Inspect the dispatched worker and the review-bundle issue produced in the control repository.

## Campaign memory

The campaign keeps bounded dispatch state on the `memory/squad-advisory` branch: one `advisories/<owner>__<repository>.json` record holding only `target_repo`, `last_advised_at`, `run_url`, `default_branch_head`, and `recommendation_count`. The orchestrator reads those records to defer any repository advised within the last 30 days; the worker writes its own record after filing a plan. Findings, issue bodies, repository content, and agent transcripts are never written to memory.

## Safety Boundaries

- CAO policy decides whether and where the campaign may run; workflow capabilities do not grant rollout authority.
- The orchestrator only ranks and dispatches. The worker cannot discover repositories, dispatch more work, or widen mode.
- The squad roster is fixed at compile time. Target repository content — including any `.squad/` directory — is untrusted evidence and can never change who reviews, what they may do, or where output goes.
- GitHub reads use scoped read-only tools. Repository mutations use declared safe outputs only. The research worker files one issue per run, and the farm-snapshot worker opens at most one pull request per run, limited to `farm/**` in the control repository.
- The worker is review-capped: `max-mode` limits it to `review` regardless of the campaign's resolved mode.
- Stable titles and deduplication prevent equivalent plans from being recreated, and the memory cooldown prevents re-advising a repository whose plan has not been read.

## Cost

The orchestrator allows 250 AI Credits and 15 minutes; research allows 600
credits and 45 minutes; farm snapshot allows 150 credits and 20 minutes.
One orchestrator plus one research worker therefore allows 850 credits; adding
the snapshot worker brings that combination to 1,000. The schedule is daily,
with a default one-repository selection cap and a four-dispatch hard ceiling.
These are declared ceilings, not measured consumption.

The inherited orchestrator still declares `worker_credits_per_target: 600`;
it does not account for the additional snapshot worker in that estimate.

## Operational Value

The campaign retains a standalone grader script at
`.github/graders/squad-advisory-research-operational-value.sh`:

| Worker | Primary metric | Attained evidence |
| --- | --- | --- |
| Research | `decision-ready-repository-plan` | One target-bound issue includes a single next action, the repository read, triaged recommended work, decisions needed, exclusions, evidence, the squad's perspectives, and a ready-to-run agent prompt. |

The evaluator grades validated requests available in the current run. It does not treat a requested issue as read, accepted, or acted on. Missing target evidence and explicit no-op outcomes remain `null`; malformed, untriaged, or off-target requests score `0`.

The current research workflow does not register this script through
`operational-value`, and the campaign manifest does not explicitly include it.
Its presence is not evidence of a running operational-value evaluation.

## Retained Trial Limitations

The following behavior needs reconciliation before treating this trial as a
production-ready campaign:

- **Cadence is prompt-driven.** The orchestrator says to defer repositories for
  30 days, but also asks for farm reassessment after 14 days or completion of a
  component sweep. These are competing instructions, not a deterministic
  scheduler. An explicit human target bypasses the orchestrator's cooldown, not
  the worker's duplicate-plan checks.
- **Memory contracts differ.** The worker records `default_branch_head` for
  duplicate detection; the orchestrator's allowed-field list omits it. Memory is
  written after an issue is requested, not after confirmed issue publication.
- **Farm scope needs tightening.** The research pre-fetch derives farm entries
  from a target checkout containing `cao.json`, whereas authority belongs to
  the control repository's policy at the workflow revision. The separate App
  token is limited to at most 16 same-owner repositories; snapshot collection
  also excludes the control repository. Neither worker provides an unlimited
  or complete cross-owner portfolio view.
- **Portfolio alignment is best-effort.** Component workers are asked to read
  sibling advisory issues, but shared GitHub tools are target-scoped and those
  issue bodies are not supplied in the deterministic evidence file.
- **Publication controls need runtime proof.** Stable titles, title
  deduplication, closing older issues, and 14-day expiry are configured, but
  their interaction across several target repositories in one review
  repository has not been established by this source import.
- **Snapshots are samples, not replicas.** They include truncated files and a
  bounded source sample. Redaction is heuristic and still requires human
  review. Failed reads can replace a prior snapshot with an unreadable marker;
  the worker is not instructed to reject every partial snapshot.
- **Cost and evaluation are incomplete.** The snapshot budget is missing from
  the orchestrator's per-target estimate, and the retained grader is not wired
  into workflow execution.

The built-in roster does not install or invoke the separate Squad product.
Using that product across the farm still requires a separately reviewed Squad
installation and merged snapshot pull requests.

## Pause or Stop

Set `control-plane.campaigns.squad-advisory.enabled` to `false` in a reviewed policy change and cancel active runs. Disable the worker for a narrower stop. Re-enable in review mode after resolving the incident.

## Attribution

The research → triage → plan shape, the separation of work from decisions, and the fact-checker and responsible-AI quality roles are adapted from the [Squad](https://github.com/bradygaster/squad) multi-agent team model (MIT). No Squad source is vendored; the roster and prompts here are written for this campaign's contract.
