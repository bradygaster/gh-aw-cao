# Squad consolidation source coverage

This document distinguishes executable source from preservation. The canonical
remote branch is `squad-advisory`. Its working tree is updated fork main plus
the disabled campaign, optional campaign-local evidence modules, focused tests,
and this documentation. It does not merge Squad into main.

## What works, and what remains inactive

| Capability | Current status |
| --- | --- |
| Policy-bounded dispatcher and single-target snapshot issue | Executable workflow source and generated locks; campaign and worker disabled, review-only, one repository by default. |
| Exact multi-owner farm enrollment, immutable source reads, bounded/redacted evidence, visibility checks | Executable `runtime/squad-farm.mjs`, covered by farm and wave tests. No target discovery or target writes. |
| Receipt-owned run-local evidence provider | Executable extension source in `runtime/squad-wave-evidence.mjs`, covered by installed-closure and wave tests. Not installed or activated by the snapshot campaign. |
| Restored publication bundle validation | Executable; explicit absolute path, hashes, coverage, freshness, issue and enrollment verified. An empty explicit path is rejected. |
| Native installation/update, cast bootstrap, native research, triage, planning | **Inactive historical code**, not current behavior. Complete source remains reachable in this branch's Git history; see the retrieval commands below. |
| Native receipt/compiler/default-branch activation and provenance checks | **Inactive historical code**, preserved with the native lineage. No manual receipt editing or remote workflow activation. |
| Farm-file refresh and native attribution/acceptance | **Inactive historical code**. Issue snapshots and run-local bundles do not replace accepted baseline ownership or native review attribution. |
| Bespoke CAO research worker and operational-value grader | **Inactive historical code**. Not installed: they are not a substitute for native Squad and do not establish measured operational value. |
| Associated standalone workflow dashboard membership | **Inactive historical code**, not added as a collateral dashboard/model change. |
| Squad 2.0 | No new implementation or dependency upgrade. |

Native integration is pending, not silently removed and not claimed complete.
The old onboarding path modifies CAO's core CLI, materializer, inventory and
runtime packaging, trusts a fixed fork catalog, and resolves a hardcoded Squad
development package. Reintroducing those hooks conflicts with the reviewed
campaign boundary and configurable deployment identity requirement. A supported
native package handoff must own its package selection, compiler compatibility,
installation receipt, cast, research and publication gates without patching
core. Operator-facing integration belongs in the native Go extension, not a new
Node or shell operator command. Existing native installations are not migrated
by this branch.

The snapshot dispatch-bot portability blocker in the README also remains.
There is no inferred activation, broadened bot allowlist, credential reach,
live mode, farm enrollment, or deployment in this consolidation.

## Source decisions

`retained` means executable source at the paths above. `superseded` identifies
behavior replaced by a safer retained path. `inactive` means historical code
only. All historical sources below remain reachable, including their original
tests, even where their working-tree changes are rejected.

| Source commit | Decision and coverage |
| --- | --- |
| `1612770fa6b6f7fa7c536ab72799a58110d7279b` | Retained catalog-only dispatcher, snapshot issue worker, declaration, disabled policy and contracts. Manifest compiler aligned to current main instead of historical v0.92.5. Locks regenerated, not copied. |
| `9c49fd471cdbee7879e1f50ea43480272f4d4a6f` | Catalog branch tip; unrelated upstream/control/Azure changes superseded by updated main. |
| `383e8c0eb711c95a543475ae211cd218a9947831` | Retained pure farm collector under campaign runtime. Native onboarding, core CLI/materializer and fixed fork trust changes inactive; rejected as current integration, not erased. |
| `2273c378f678fe0ae6067e2ce01fe415a9c33095` | Runtime-validation merge adaptation superseded by main's unchanged runtime. Farm/advisory native lineage preserved inactive. |
| `aad2ffc6c` / `19794391a` | Original and replayed mandatory native onboarding/casting/research preserved inactive; not replaced by issue snapshots. |
| `dd12c7656` / `4194dead6` | Native campaign-enable activation preserved inactive; no core enable hook added. |
| `434418634` / `dfb598763` | Immutable installed-root activation bootstrap preserved inactive. |
| `6bb9a902c` / `e876b5cf1` | Avoid-root-reinstall correction preserved inactive with onboarding. |
| `35b69d34540daa92997843d5d0592d38fe3782e4` / `8c8481d69` | Native compiler configuration byte/presence binding preserved inactive. Current campaign compiler is pinned to main. |
| `a1e5f0642` | Router reconciliation and compiler integrity documentation preserved inactive, not represented as a supported installation procedure. |
| `bea0374aed453a15748e00a4bda19f4aab5565ad` | Draft farm snapshot PR/maintainer review design preserved inactive; current issue worker does not modify receipt-owned farm files. |
| `50e594168` | Native review provenance refresh preserved inactive; no unattributed PR fallback. |
| `21322a1b2` / `3151ba1c5` / `8f6e088fe` | Native campaign inventory attribution, exact manifest workflow paths and both verified provenance forms preserved inactive; no core inventory/dashboard patch. |
| `1d34979a1beb7024e2271496275596642a97be10` | Retained receipt-owned provider, bounded authenticated reads and wave provenance/validation in campaign runtime; installer hooks inactive. |
| `7741c4e462ec5d4f553ea4ff9fc014b1b3c09793` | Provider branch history preserved. Retained implementation selected from later `84eb69b47`, not inferred from branch name. |
| `84eb69b471b665c4c27e7eb8828c6e45788f4390` | Retained explicit publication-gate path validation and installed CLI tests; corrected empty-string fallback to fail closed. Dependency closure adapted to current authority module. |
| `7664c2869f0fdd58deed873d51a2d274c51b3f80` | Alternate nullish bundle override superseded by normalized absolute-path validation, retaining its fail-closed empty-path semantics. |
| `c4d92bda6` | Original disabled bespoke research worker and operational-value grader preserved inactive. No claims that proposal generation measures accepted planning outcomes. |
| `0bc683ec36cceb2abaab3c6d8c3e89f6a28f35f7` | Standalone campaign dashboard membership work preserved inactive; unrelated dashboard facets/value retention not imported. |
| `3d42b1d12bb1d6901bb82f995a12f916b0b1d243` | Dashboard-ideation branch has no additional committed Squad implementation; base superseded by main. |
| `efb7fd2264a5073598d8dfffaad64ef91cfb564c` | Local Azure-readiness tip preserves native attribution variants above; old Azure/control changes superseded by final main, not overlaid. |
| `72bd60fc003767fecc3deaf2f10073a514d6d9df` | Remote Azure-readiness variant preserved; Azure/deployment code comes only from final main. |
| `f2eeb612d` / `d50a3d5bd` | Early advisory/portfolio and cadence design preserved inactive, superseded by bounded review-only catalog campaign. |
| `874e287ed` / `53f7c6a54` | Early secret sanitization and scoped-read intent retained through bounded redaction and inherited target credentials, not old broad coordinator code. |
| `73e3bb40e` / `9312e47e5` / `177da88a4` | Trial farm refresh, untracked-runner-state and INDEX destination changes preserved inactive. Native farm receipt/review requirements prevent copying this PR writer into current workflows. |

## Every saved archive variant

The 36 original annotated tags under `squad-archive/2026-10-21/` remain untouched.
Their peeled commits, plus `origin/squad-advisory-trial`, are retained as ancestors
using a history-only merge: **no old tree is selected by that merge**. This
preserves the code in one branch without reviving old Azure, core, dashboard or
rollout changes. Reachability is not successful integration or validation.

| Archive suffix | Peeled source commit | Disposition |
| --- | --- | --- |
| `branch/azure-deployment-readiness` | `efb7fd2264a5073598d8dfffaad64ef91cfb564c` | Native variants inactive; Azure superseded by main. |
| `branch/azure-deployment-readiness-remote` | `72bd60fc003767fecc3deaf2f10073a514d6d9df` | Historical remote variant; no Azure overlay. |
| `branch/cao-farm-snapshot-marker` | `bea0374aed453a15748e00a4bda19f4aab5565ad` | Native farm PR marker inactive. |
| `branch/cao-wave-evidence-provider` | `7741c4e462ec5d4f553ea4ff9fc014b1b3c09793` | Superseded by later retained provider. |
| `branch/cao-wave-evidence-provider-360` | `84eb69b471b665c4c27e7eb8828c6e45788f4390` | Provider retained/adapted; native hooks inactive. |
| `branch/farm-snapshot-refresh-fix` | `2273c378f678fe0ae6067e2ce01fe415a9c33095` | Native refresh inactive. |
| `branch/native-squad-cao-onboarding` | `35b69d34540daa92997843d5d0592d38fe3782e4` | Native installer/activation inactive. |
| `branch/squad-advisory-layer` | `2273c378f678fe0ae6067e2ce01fe415a9c33095` | Same native source as refresh branch. |
| `branch/squad-advisory-updates` | `0bc683ec36cceb2abaab3c6d8c3e89f6a28f35f7` | Dashboard association inactive. |
| `branch/squad-catalog-campaign` | `9c49fd471cdbee7879e1f50ea43480272f4d4a6f` | Campaign retained/adapted. |
| `branch/squad-dashboard-ideation` | `3d42b1d12bb1d6901bb82f995a12f916b0b1d243` | No unique committed Squad code. |
| `branch/squad-evidence-path-fix` | `7664c2869f0fdd58deed873d51a2d274c51b3f80` | Superseded path variant; explicit empty path fails. |
| `checkpoint/advisory-updates-01-842748fe3` | `842748fe3450b648f7be429da4b0089044de79ba` | Inactive bespoke-research trial variant. |
| `checkpoint/advisory-updates-02-b00ce06f7` | `b00ce06f79c7a8773f4e5808faf8d7c935635f48` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-03-96d877746` | `96d877746665a4ff826e7a39c0a105f197a9f800` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-04-15fba2770` | `15fba27709e0058dc19699f78e0431b0b62ccd11` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-05-333ef7573` | `333ef75735279543ee628991494ec8bb4d8dbb59` | Both verified native provenance forms; inactive. |
| `checkpoint/advisory-updates-06-3dcd420c2` | `3dcd420c200dcd9b617ab1bde33845cf814991e9` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-07-e06a53939` | `e06a53939f498d51b164d41ae09dd42434bd76b3` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-08-7de373671` | `7de373671d4b19a6be3da11253a77a66b206503f` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-09-1c2687586` | `1c2687586c498dca97d6f6461cf7b425aef34efc` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-10-0bb184297` | `0bb1842974d015d554c5d027ac90d8ef85cbf2ff` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-11-0788cf560` | `0788cf56034d4b8e4d449bacf423a28bae98e42c` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-12-d21d3c6f0` | `d21d3c6f0048ff3ccb8e141b62bfe9983583ed57` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-13-af175b514` | `af175b5144a46a8150d82fcdee19a4e17a1edc40` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-14-9bbda34d8` | `9bbda34d88536c8c582249cc916a72fad56df17d` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-15-97fc8e320` | `97fc8e32039431a8fca9adea1c31bf2652118482` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-16-f846a6e20` | `f846a6e2060e387d2c80004c1ec53947efddfd2e` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-17-6e921a070` | `6e921a0701976cc22e19f581455afb39614a9354` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-18-79ec52ca3` | `79ec52ca3c6155f1a1b88f18a714a15769e308e9` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-19-72b3b4b38` | `72b3b4b3853422479251c9202ad94e34a880fb19` | Exact manifest workflow path provenance; inactive. |
| `checkpoint/advisory-updates-20-34af5db0c` | `34af5db0caea26762b5a8edba489e03bf2df616e` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-21-5684a5d99` | `5684a5d99fb25489d82df754eba3e04123e1c2d2` | Inactive trial/documentation variant. |
| `checkpoint/advisory-updates-22-0519c5bea` | `0519c5bea830c88788b1b5a0abc04cf43abd9617` | Inactive trial/documentation variant. |
| `stash/wave-evidence-360-4fdf4566b` | `4fdf4566b332546cd7070eb0cb106858d81abcbe` | Same validation-path patch as `84eb69b47`; retained with empty-path correction. |
| `stash/wave-evidence-360-61452212a` | `61452212a1088af56e9247a008496f8b7bcdd0c9` | Same validation-path patch; retained with empty-path correction. |

The inactive location is historical Git trees, not `.github/workflows/` in the
current tree or installable manifest. Inspect from a clone of this one branch:

```sh
git show 35b69d345:activity/squad-onboarding.mjs
git show efb7fd226:activity/squad-onboarding.mjs
git show 2273c378f:.github/workflows/squad-advisory-research.md
git show 0bc683ec3:dashboard/site/dashboard-fragments/campaigns.json
git diff 4fdf4566b^ 4fdf4566b -- activity/squad-wave-evidence.mjs
git merge-base --is-ancestor 84eb69b47 HEAD
```

Do not restore an old tree over current main, run historical onboarding against
a control repository, edit native receipts, or enable workflows as a shortcut.
The original remote tags, branches, worktrees, offline bundle, and uncommitted
files are not deleted or rewritten by this consolidation.
