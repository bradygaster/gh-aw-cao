import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverInventory } from "../../activity/inventory.mjs";
import { buildInventoryDashboardSources } from "../../activity/inventory-sources.mjs";
import { queryDashboardSourceObservations } from "../../dashboard/site/src/data/queries/ingestion.js";
import { adaptGhAwLogs } from "../../dashboard/site/src/data/adapters/gh-aw-logs.js";
import { normalize } from "../../dashboard/site/src/data/normalize/index.js";

test("attributes adopted native Squad and its bootstrap run without granting CAO worker authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "activity-squad-inventory-"));
  const names = ["squad", "squad-bootstrap", "squad-command-router", "squad-implement-worker",
    "squad-deps-worker", "squad-review", "squad-retro", "squad-improvement-worker"];
  const revision = "a".repeat(40);
  const generatedAt = "2026-10-09T00:00:00Z";
  const manifestPath = ".github/aw/squad-workflows.manifest.json";
  const receiptPath = ".github/cao/squad-install.json";
  const write = async (file, content) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  };
  const policy = { "control-plane": { campaigns: { "squad-advisory": { enabled: false } } } };
  try {
    await write(".github/workflows/cao.json", JSON.stringify(policy));
    for (const name of names) {
      const source = ["squad", "squad-review", "squad-bootstrap", "squad-command-router"].includes(name)
        ? "bradygaster/squad/workflows" : `bradygaster/squad/workflows/package/${name}.md`;
      await write(`.github/workflows/${name}.md`,
        `---\nname: ${name}\nsource: ${source}@${revision}\n---\n`);
      await write(`.github/workflows/${name}.lock.yml`, '# gh-aw-metadata: {"compiler_version":"0.91.5"}\n');
    }
    assert.ok(discoverInventory(root).workflows.every((workflow) => !workflow.associatedCampaign));
    const manifest = JSON.stringify({
      schema_version: 2, package: "bradygaster/squad/workflows",
      workflows: names.map((name) => ({
        name, source: `workflows/package/${name}.md`,
        destination: `.github/workflows/${name}.md`, lock: `.github/workflows/${name}.lock.yml`,
      })),
      shared_runtime: [], skills: [],
    });
    await write(manifestPath, manifest);
    await write(".github/aw/packages/bradygaster-squad-workflows-3632054824e8.json", JSON.stringify({
      package: "bradygaster/squad/workflows", resolvedCommit: revision,
      files: [{ destination: manifestPath, sha256: createHash("sha256").update(manifest).digest("hex") }],
    }));
    const receipt = { schema: "cao-squad-install/v1", source_revision: revision };
    await write(receiptPath, JSON.stringify(receipt));
    const inventory = discoverInventory(root);
    assert.equal(inventory.workflows.length, 8);
    for (const workflow of inventory.workflows) {
      assert.equal(workflow.associatedCampaign, "squad-advisory");
      assert.equal(workflow.role, "standalone");
      assert.equal(workflow.controlCampaign, "");
    }
    const sources = buildInventoryDashboardSources({
      repository: "acme/ops", generatedAt, inventory,
      controlSettings: { campaigns: { "squad-advisory": { enabled: false, mode: "review" } } },
      workflowRegistries: [{
        repository: "acme/ops", expected: 1, observed: 1, pages: 1, state: "complete", failure: null,
        workflows: [{
          repository: "acme/ops", id: 101, name: "Squad bootstrap",
          path: ".github/workflows/squad-bootstrap.lock.yml", state: "active",
          htmlUrl: "https://github.com/acme/ops/actions/workflows/101",
        }],
      }],
    });
    assert.equal(sources.campaigns.rows.length, 1);
    for (const workflow of sources.workflows.rows) {
      assert.equal(workflow.campaign, "squad-advisory");
      assert.equal(workflow["workflow-role"], "standalone");
      assert.equal(workflow["admission-status"], undefined);
      assert.equal(workflow["rollout-mode"], "unknown");
      assert.equal(workflow["campaign-targets"], undefined);
    }
    const run = adaptGhAwLogs({
      observedAt: generatedAt,
      repository: { githubId: 1, owner: "acme", name: "ops", visibility: "private" },
      workflow: { githubId: 101, name: "Squad bootstrap", path: ".github/workflows/squad-bootstrap.lock.yml" },
      run: { githubRunId: 9001, attempt: 1, event: "push", status: "completed", conclusion: "success" },
      files: [],
    }).observations;
    const canonical = normalize([...run, ...queryDashboardSourceObservations(sources).observations], {
      sourcePrecedence: { "gh-aw-logs": 1, "dashboard-sources": 2 },
    });
    const bootstrap = canonical.workflows.find((workflow) => workflow.githubId === "101");
    assert.equal(canonical.runs[0].workflowId, bootstrap.id);
    assert.equal(bootstrap.campaignId, canonical.campaigns[0].id);
    await write(receiptPath, JSON.stringify({ ...receipt, source_revision: "b".repeat(40) }));
    assert.throws(() => discoverInventory(root), /installation records disagree/);
    await write(receiptPath, JSON.stringify(receipt));
    await write(manifestPath, `${manifest}\n`);
    assert.throws(() => discoverInventory(root), /installation records disagree/);
    await write(manifestPath, manifest);
    for (const coordinate of [
      `unrelated/squad/workflows@${revision}`,
      `bradygaster/squad/workflows@${"b".repeat(40)}`,
      `bradygaster/squad/workflows/package/squad.md@${revision}`,
      `bradygaster/squad/workflows/package/squad-bootstrap.md@${"b".repeat(40)}`,
    ]) {
      await write(".github/workflows/squad-bootstrap.md", `---\nsource: ${coordinate}\n---\n`);
      assert.throws(() => discoverInventory(root), /source revision differs/);
    }
    await write(".github/workflows/squad-bootstrap.md", "---\nname: Unrelated\n---\n");
    assert.throws(() => discoverInventory(root), /source revision differs/);
    await write(".github/workflows/cao.json", '{"control-plane":{"campaigns":{}}}');
    assert.ok(discoverInventory(root).workflows.every((workflow) => !workflow.associatedCampaign));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects installed campaign revisions and local compiler metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "activity-inventory-"));
  const workflows = path.join(root, ".github", "workflows");
  const campaigns = path.join(root, ".github", "aw", "campaigns");
  const intelligence = path.join(root, ".github", "cao", "intelligence");
  const sourceRevision = "1".repeat(40);
  const campaignRevision = "2".repeat(40);
  try {
    await mkdir(workflows, { recursive: true });
    await mkdir(campaigns, { recursive: true });
    await mkdir(intelligence, { recursive: true });
    await writeFile(path.join(workflows, "cao.json"), JSON.stringify({
      "control-plane": {
        campaigns: {
          dependabot: { enabled: true, mode: "review" },
        },
      },
    }));
    await writeFile(path.join(workflows, "dependabot.md"), `---
name: Dependabot
source: githubnext/gh-aw-cao@${sourceRevision}
---
`);
    const intelligenceDeclaration = {
      contractVersion: "1.0.0",
      campaign: "dependabot",
      fields: {
        intendedOutcome: {
          statement: "Reduce open dependency security risk.",
        },
      },
    };
    await writeFile(
      path.join(intelligence, "dependabot.json"),
      JSON.stringify(intelligenceDeclaration),
    );
    await writeFile(
      path.join(workflows, "dependabot.lock.yml"),
      '# gh-aw-metadata: {"compiler_version":"0.89.15","strict":true}\n',
    );
    await writeFile(path.join(campaigns, "dependabot.json"), JSON.stringify({
      schemaVersion: 1,
      campaign: "githubnext/gh-aw-cao/dependabot",
      source: `githubnext/gh-aw-cao/dependabot@${campaignRevision}`,
      resolvedCommit: campaignRevision,
      installer: "gh-aw v0.89.15",
      files: [],
    }));

    const inventory = discoverInventory(root);

    assert.deepEqual(inventory.campaigns, [{
      id: "dependabot",
      name: "dependabot",
      campaign: "githubnext/gh-aw-cao/dependabot",
      source: `githubnext/gh-aw-cao/dependabot@${campaignRevision}`,
      resolvedCommit: campaignRevision,
      installer: "gh-aw v0.89.15",
      intelligenceDeclaration,
    }]);
    assert.equal(inventory.workflows[0].source, `githubnext/gh-aw-cao@${sourceRevision}`);
    assert.equal(inventory.workflows[0].version, sourceRevision);
    assert.equal(inventory.workflows[0].ghAwVersion, "v0.89.15");
    assert.equal(
      Object.hasOwn(discoverInventory(root, { generatedAt: "" }), "generatedAt"),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers source declarations and rejects conflicting installed copies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "activity-intelligence-"));
  const workflows = path.join(root, ".github", "workflows");
  const intelligence = path.join(root, ".github", "cao", "intelligence");
  const campaign = path.join(root, "maintenance");
  try {
    await mkdir(workflows, { recursive: true });
    await mkdir(intelligence, { recursive: true });
    await mkdir(campaign, { recursive: true });
    await writeFile(path.join(workflows, "cao.json"), JSON.stringify({
      "control-plane": {
        campaigns: {
          maintenance: { enabled: true, mode: "review" },
        },
      },
    }));
    await writeFile(path.join(campaign, "aw.yml"), `name: Maintenance
includes:
  - .github/workflows/maintenance.md
`);
    await writeFile(path.join(campaign, "intelligence.json"), JSON.stringify({
      contractVersion: "1.0.0",
      campaign: "maintenance",
      fields: {
        intendedOutcome: {
          statement: "Reduce unresolved maintenance work.",
        },
      },
    }));
    await writeFile(path.join(workflows, "maintenance.md"), `---
name: Maintenance
---
imports:
  - uses: shared/control.md
    with:
      campaign: maintenance
      role: orchestrator
`);

    const inventory = discoverInventory(root);
    assert.equal(
      inventory.bundles[0].intelligenceDeclaration.fields.intendedOutcome.statement,
      "Reduce unresolved maintenance work.",
    );

    await writeFile(path.join(intelligence, "maintenance.json"), JSON.stringify({
      contractVersion: "1.0.0",
      campaign: "maintenance",
      fields: {
        intendedOutcome: {
          statement: "A conflicting installed outcome.",
        },
      },
    }));
    assert.throws(
      () => discoverInventory(root),
      /Campaign intelligence declarations conflict for maintenance/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
