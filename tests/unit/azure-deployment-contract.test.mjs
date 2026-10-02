import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Azure deployment profile is a host-only overlay with required Redis TLS", async () => {
  const profile = JSON.parse(await text(".github/workflows/cao.azure.json"));

  assert.equal(profile.extends, "cao.json");
  assert.deepEqual(Object.keys(profile).sort(), ["control-plane", "extends"]);
  assert.deepEqual(Object.keys(profile["control-plane"]), ["web"]);
  assert.deepEqual(Object.keys(profile["control-plane"].web), ["host"]);
  assert.deepEqual(profile["control-plane"].web.host, {
    target: { module: "azure-functions" },
    redis: {
      module: "azure-managed-redis",
      "url-env": "CAO_REDIS_URL",
      "namespace-env": "CAO_REDIS_NAMESPACE",
      tls: { mode: "required" },
    },
  });
});

test("CAO server image contains the reviewed Azure deployment profile", async () => {
  const dockerfile = await text("server/Dockerfile");
  assert.match(
    dockerfile,
    /COPY --from=dashboard-build --chown=cao:cao \/workspace\/\.github\/workflows\/cao\.azure\.json \/app\/\.github\/workflows\/cao\.azure\.json/,
  );
});

test("Azure operator command keeps secrets out of configuration and automates the lifecycle", async () => {
  const script = await text("scripts/azure/cao-azure.sh");
  const example = JSON.parse(await text("server/azure/config.example.json"));

  for (const command of [
    "preflight",
    "bootstrap",
    "validate",
    "infrastructure",
    "package",
    "publish",
    "ingest",
    "verify",
    "deploy",
    "destroy",
  ]) {
    assert.match(script, new RegExp(`\\b${command}\\)`));
  }
  assert.match(script, /npm config set registry "\$PROXY_REGISTRY"/);
  assert.match(script, /npm config set registry "\$npm_registry"/);
  assert.match(script, /npm config delete proxy/);
  assert.match(script, /npm config set proxy "\$npm_proxy"/);
  assert.match(script, /--file "\$file"/);
  assert.match(script, /az deployment group what-if/);
  assert.match(script, /az provider show --namespace/);
  assert.match(script, /registration is still converging/);
  assert.match(script, /az containerapp job --help/);
  assert.match(script, /az containerapp job start/);
  assert.match(script, /did not finish within 125 minutes/);
  assert.match(script, /main deployment failed after three attempts/);
  assert.match(script, /package builds require a clean Git worktree/);
  assert.match(script, /if has\("enablePurgeProtection"\)/);
  assert.match(script, /enablePurgeProtection must be a boolean/);
  assert.match(script, /trap 'rm -rf "\$secret_dir"' EXIT/);
  assert.match(script, /secret_exists cao-session-secret/);
  assert.match(script, /az functionapp deployment source config-zip/);
  assert.equal("githubClientSecret" in example, false);
  assert.equal("sessionSecret" in example, false);
  assert.equal("postgresAdministratorPassword" in example, false);
});

test("generated Azure operator artifacts stay outside repository lint inputs", async () => {
  const eslintConfig = await text("eslint.config.mjs");
  assert.match(eslintConfig, /"\.cao\/\*\*"/);
});
