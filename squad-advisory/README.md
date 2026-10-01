# Squad Advisory

> [!NOTE]
> **Experimental campaign:** The squad roster, triage buckets, and output contract may change as review evidence accumulates.

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

## What the plan contains

The worker's output is triaged, because an undifferentiated list of ideas is not a plan:

- **Recommended work** — at most seven items the owners could act on now, grouped into at most three ordered phases, with the single highest-return starting point named.
- **Decisions needed** — at most four choices only the owners can make, each with its options, costs, and the evidence that would settle it. The squad never decides for them.
- **Excluded** — at most five things considered and deliberately set aside, with the reason.

The issue also carries the evidence the plan rests on, each member's perspective with the fact checker's verdicts, and one ready-to-run agent prompt for the starting item.

## Recommending Squad itself

Squad can also run natively inside a repository, where maintainers drive it with `/squad` issue commands. That install is a per-repository choice: it adds eight agentic workflows, needs a human-reviewed bootstrap pull request, and requires repository settings changes only an administrator can make.

This campaign therefore never installs Squad anywhere. When the worker finds no `squad.md` or `squad-bootstrap.md` in a target repository, it raises enlistment as a **decision** for the owners, pointing at the [Squad GitHub Agentic Workflows quick start](https://bradygaster.github.io/squad/docs/guide/gh-aw/) and supplying the instruction to hand a coding agent. Whether to accept stays with the repository's owners.

## Install

Install the campaign into a Central Agentic Ops control repository:

```bash
gh aw add githubnext/gh-aw-cao/squad-advisory
```

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
					"research": { "workflow": "squad-advisory-research", "max-mode": "review" }
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
- GitHub reads use scoped read-only tools. Repository mutations use declared safe outputs only: one issue per run.
- The worker is review-capped: `max-mode` limits it to `review` regardless of the campaign's resolved mode.
- Stable titles and deduplication prevent equivalent plans from being recreated, and the memory cooldown prevents re-advising a repository whose plan has not been read.

## Cost

One orchestration is bounded by 850 AI Credits: 250 for the orchestrator plus one 600-credit worker. The worker's budget covers seven squad members and the coordinator, which is why `max-repositories` defaults to `1` and the schedule is weekly rather than hourly. Deep advisory research is worth doing rarely and well.

## Operational Value

The worker registers a deterministic one-shot operational grader through gh-aw's `operational-value` protocol:

| Worker | Primary metric | Attained evidence |
| --- | --- | --- |
| Research | `decision-ready-repository-plan` | One target-bound issue includes a single next action, the repository read, triaged recommended work, decisions needed, exclusions, evidence, the squad's perspectives, and a ready-to-run agent prompt. |

The evaluator grades validated requests available in the current run. It does not treat a requested issue as read, accepted, or acted on. Missing target evidence and explicit no-op outcomes remain `null`; malformed, untriaged, or off-target requests score `0`.

## Pause or Stop

Set `control-plane.campaigns.squad-advisory.enabled` to `false` in a reviewed policy change and cancel active runs. Disable the worker for a narrower stop. Re-enable in review mode after resolving the incident.

## Attribution

The research → triage → plan shape, the separation of work from decisions, and the fact-checker and responsible-AI quality roles are adapted from the [Squad](https://github.com/bradygaster/squad) multi-agent team model (MIT). No Squad source is vendored; the roster and prompts here are written for this campaign's contract.
