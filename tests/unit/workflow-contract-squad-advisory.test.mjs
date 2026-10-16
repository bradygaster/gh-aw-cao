import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { mergeCaoCampaignDeclaration, validateCampaignDeclaration } from "../../activity/cli/policy.mjs";
import { effectivePolicy, parsePolicy } from "../../.github/workflows/shared/policy.mjs";
import { controlPolicy, root, workflow } from "./workflow-contract.helpers.mjs";

const directory = join(root, "squad-advisory");
const manifest = parse(readFileSync(join(directory, "aw.yml"), "utf8"));
const declaration = JSON.parse(readFileSync(join(directory, "cao.json"), "utf8"));
const names = [declaration.orchestrator, ...Object.values(declaration.workers)];

function config(name) {
  return parse(/^---\n([\s\S]*?)\n---/.exec(workflow(`${name}.md`))[1]);
}

function runModeGate(name, envelope) {
  const source = config(name).steps[0].run;
  const script = /node --input-type=module -e '([\s\S]*)'\s*$/.exec(source)[1];
  return runInNewContext(script.replace('import { readFileSync } from "node:fs";', ""), {
    readFileSync(path, encoding) {
      assert.equal(path, "/tmp/gh-aw/agent/control-precompute.json");
      assert.equal(encoding, "utf8");
      return JSON.stringify(envelope);
    },
  });
}

test("Squad is a complete catalog package, not implicit control-plane activation", () => {
  assert.equal(validateCampaignDeclaration(declaration, "squad-advisory/cao.json"), declaration);
  assert.equal(manifest["min-version"], controlPolicy["gh-aw-version"]);
  assert.equal(manifest.experimental, true);
  assert.equal(manifest.private ?? false, false);
  assert.deepEqual(manifest.includes.toSorted(), [
    "README.md",
    ...names.map((name) => `.github/workflows/${name}.md`),
  ].sort());
  for (const forbidden of ["config", "resources", "agents", "skills"]) {
    assert.equal(manifest[forbidden], undefined);
  }
  const registration = controlPolicy["control-plane"].campaigns[declaration.campaign];
  assert.equal(registration.enabled, false);
  assert.equal(registration.mode, "review");
  assert.equal(registration.workers["farm-snapshot"].enabled, false);
  assert.equal(registration.workers["farm-snapshot"]["max-mode"], "review");
  const decision = effectivePolicy(parsePolicy(JSON.stringify(controlPolicy)), {
    campaignName: declaration.campaign,
    role: "orchestrator",
    controlRepository: "fixture-owner/control",
  });
  assert.equal(decision.authorized, false);
  assert.equal(decision.reason, "campaign-disabled");
});

test("ordinary declaration merging preserves scope, mode, disablement, and unrelated campaigns", () => {
  const policy = structuredClone(controlPolicy);
  policy["control-plane"].campaigns[declaration.campaign] = {
    enabled: false,
    mode: "review",
    workers: { "farm-snapshot": { enabled: false, "max-mode": "review" } },
  };
  const before = structuredClone(policy);
  mergeCaoCampaignDeclaration(policy, declaration);
  const campaign = policy["control-plane"].campaigns[declaration.campaign];
  assert.deepEqual(campaign, {
    ...before["control-plane"].campaigns[declaration.campaign],
    workers: {
      "farm-snapshot": {
        workflow: "squad-advisory-farm-snapshot",
        enabled: false,
        "max-mode": "review",
      },
    },
  });
  policy["control-plane"].campaigns[declaration.campaign] =
    before["control-plane"].campaigns[declaration.campaign];
  assert.deepEqual(policy, before);
});

test("Squad workflows inherit admission, target credentials, and safe-output staging", () => {
  for (const name of names) {
    const source = workflow(`${name}.md`);
    const settings = config(name);
    const control = settings.imports.find((entry) => entry.uses === "shared/control.md");
    assert.equal(control.with.campaign, declaration.campaign);
    assert.equal(control.with.role, name === declaration.orchestrator ? "orchestrator" : "worker");
    assert.equal(settings.if, "needs.pre_activation.outputs.cao_authorized == 'true'");
    assert.equal(settings.strict, true);
    assert.equal(settings.evals, undefined);
    assert.equal(settings["github-token"], undefined);
    assert.equal(settings["github-app"], undefined);
    assert.equal(settings.checkout, undefined);
    for (const [permission, value] of Object.entries(settings.permissions)) {
      if (permission === "copilot-requests") {
        assert.equal(value, "write");
      } else {
        assert.equal(value, "read");
        assert.equal(control.with[`read_${permission.replaceAll("-", "_")}`], "read");
      }
    }
    assert.match(source, /\{\{#runtime-import\? \.github\/cao\/squad-advisory\.md\}\}\s*$/);
    assert.doesNotMatch(source, /\$\{\{[^}]*secrets\.|create-github-app-token|continue-on-error/);
    const generated = parse(workflow(`${name}.lock.yml`));
    const steps = generated.jobs.agent.steps;
    const download = steps.findIndex((step) => step.id === "cao_precompute_download");
    const credential = steps.findIndex((step) => step.id === "cao_target_read_credential");
    const guard = steps.findIndex((step) => step.name.startsWith("Require review-only Squad"));
    const execute = steps.findIndex((step) => step.name === "Execute GitHub Copilot CLI");
    assert.ok(download >= 0 && credential >= 0 && guard > download && guard > credential && execute > guard);
    assert.equal(generated.env.SAFE_OUTPUT_REPO, settings.env.SAFE_OUTPUT_REPO);
    assert.equal(generated.jobs.safe_outputs.env.GH_AW_SAFE_OUTPUTS_STAGED, "${{ inputs.safe_output_mode == 'debug' }}");
  }
});

test("Squad mode gates accept review and worker-only debug but reject live and missing modes", () => {
  for (const name of names) {
    assert.doesNotThrow(() => runModeGate(name, { safe_output_mode: "review" }));
    for (const mode of ["live", "", null, "Review", "review ", "debug"]) {
      if (name !== declaration.orchestrator && mode === "debug") {
        assert.doesNotThrow(() => runModeGate(name, { safe_output_mode: mode }));
      } else {
        assert.throws(() => runModeGate(name, { safe_output_mode: mode }), /review/);
      }
    }
    assert.throws(() => runModeGate(name, {}), /review/);
  }
});

test("Squad dispatch is bounded and worker writes only one review-routed issue", () => {
  const orchestrator = config(declaration.orchestrator);
  const worker = config(declaration.workers["farm-snapshot"]);
  assert.deepEqual(worker.on.bots, config("repo-assist-maintenance").on.bots);
  assert.deepEqual(orchestrator.on.workflow_dispatch.inputs.safe_output_mode, {
    default: "review", type: "choice", options: ["review"],
  });
  assert.deepEqual(orchestrator["safe-outputs"]["dispatch-workflow"], {
    workflows: Object.values(declaration.workers), max: 4,
  });
  assert.equal(orchestrator["safe-outputs"]["threat-detection"], false);
  assert.equal(orchestrator.tools["repo-memory"]["branch-name"], "memory/squad-advisory");
  assert.match(workflow("squad-advisory.md"), /\$GH_AW_MEMORY_DIR/);
  assert.deepEqual(worker.on.workflow_dispatch.inputs.safe_output_mode, { required: true, type: "string" });
  for (const input of [
    "target_repo", "safe_output_repo", "safe_output_mode", "correlation_id",
    "central_repo", "control_plane_run_url", "batch_label",
  ]) assert.ok(worker.on.workflow_dispatch.inputs[input]);
  const control = worker.imports.find((entry) => entry.uses === "shared/control.md");
  assert.equal(control.with.worker, "farm-snapshot");
  assert.equal(control.with.read_repository, "${{ inputs.target_repo }}");
  assert.deepEqual(Object.keys(worker["safe-outputs"]).sort(), [
    "allowed-github-references", "create-issue", "mentions",
  ]);
  const output = worker["safe-outputs"]["create-issue"];
  assert.equal(output["target-repo"], "${{ inputs.safe_output_repo || github.repository }}");
  assert.equal(output["deduplicate-by-title"], true);
  assert.equal(output.max, 1);
  assert.equal(output.expires, "14d");
  assert.deepEqual(output.labels, ["squad-advisory", "squad-advisory:farm-snapshot"]);
  assert.equal(output["close-older-issues"], undefined, "one target must not close another target's snapshot");
});

test("Squad documents bounded proposals and the unsupported native installation handoff", () => {
  const worker = workflow("squad-advisory-farm-snapshot.md");
  const readme = readFileSync(join(directory, "README.md"), "utf8");
  assert.match(worker, /one immutable commit SHA/);
  assert.match(worker, /private evidence into an internal or public repository/);
  assert.match(worker, /If output-repository reads are unavailable, report incomplete/);
  assert.match(worker, /at most 16|At most 16/);
  assert.match(worker, /12000 characters/);
  assert.match(worker, /proposed, not accepted research/);
  assert.match(readme, /not measurable yet/);
  assert.match(readme, /does \*\*not\*\* automatically install native workflows/);
  assert.match(readme, /owning\npackage can reconcile changes safely/);
  assert.match(readme, /Dispatch portability blocker/);
  assert.match(readme, /A different control repository's write App bot is not covered/);
});
