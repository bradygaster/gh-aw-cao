import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../server/azure/", import.meta.url);
const main = await readFile(new URL("main.bicep", root), "utf8");
const bootstrap = await readFile(new URL("bootstrap.bicep", root), "utf8");
const postgres = await readFile(new URL("postgres.bicep", root), "utf8");
const ingestion = await readFile(new URL("ingestion.bicep", root), "utf8");

test("Azure bootstrap creates an RBAC Key Vault without accepting secret values", () => {
  assert.match(bootstrap, /Microsoft\.KeyVault\/vaults@/);
  assert.match(bootstrap, /enableRbacAuthorization:\s*true/);
  assert.match(bootstrap, /enableSoftDelete:\s*true/);
  assert.match(bootstrap, /enabledForTemplateDeployment:\s*true/);
  assert.match(bootstrap, /param enablePurgeProtection bool = true/);
  assert.match(bootstrap, /Key Vault Secrets Officer/);
  assert.doesNotMatch(bootstrap, /clientSecret|sessionSecret|administratorLoginPassword/);
});

test("Azure main deploys private PostgreSQL and Azure Managed Redis dependencies", () => {
  assert.match(main, /Staging-ready Azure Functions deployment/);
  assert.match(main, /Microsoft\.Network\/virtualNetworks@/);
  assert.match(main, /Microsoft\.DBforPostgreSQL\/flexibleServers/);
  assert.match(main, /private\.postgres\.database\.azure\.com/);
  assert.match(main, /delegatedSubnetResourceId:\s*postgresSubnet\.id/);
  assert.match(postgres, /publicNetworkAccess:\s*'Disabled'/);
  assert.match(postgres, /name:\s*'cao-postgres-url'/);
  assert.match(postgres, /sslmode=require/);

  assert.match(main, /Microsoft\.Cache\/redisEnterprise@/);
  assert.match(main, /modules:\s*\[\s*{\s*name:\s*'RedisJSON'\s*}\s*{\s*name:\s*'RediSearch'\s*}\s*]/);
  assert.match(main, /publicNetworkAccess:\s*'Disabled'/);
  assert.match(main, /privatelink\.redisenterprise\.cache\.azure\.net/);
  assert.match(main, /groupIds:\s*\[\s*'redisEnterprise'\s*]/);
  assert.match(main, /redisDatabase\.listKeys\(\)\.primaryKey/);
  assert.match(main, /name:\s*'cao-redis-url'/);
});

test("Azure Function App uses VNet integration and versionless Key Vault references", () => {
  assert.match(main, /virtualNetworkSubnetId:\s*functionsSubnet\.id/);
  assert.match(main, /vnetRouteAllEnabled:\s*true/);
  assert.match(main, /dependsOn:\s*\[\s*functionsSubnet\s*]/);
  assert.match(main, /dependsOn:\s*\[\s*postgresSubnet\s*]/);
  assert.match(main, /dependsOn:\s*\[\s*privateEndpointsSubnet\s*]/);
  assert.match(main, /CAO_POLICY_PATH[\s\S]*cao\.azure\.json/);
  assert.match(main, /CAO_AZURE_DASHBOARD_QUERIES[\s\S]*site\/src\/agent\/queries\.generated\.json/);
  assert.match(main, /CAO_DATABASE_QUERIES[\s\S]*queries\/database\.json/);
  assert.match(main, /CAO_DASHBOARD_HOSTING[\s\S]*azure-functions/);
  assert.match(main, /Microsoft\.ManagedIdentity\/userAssignedIdentities@/);
  assert.match(main, /keyVaultReferenceIdentity:\s*functionIdentity\.id/);
  assert.match(main, /Key Vault Secrets User/);

  for (const setting of [
    "AzureWebJobsStorage",
    "CAO_POSTGRES_URL",
    "CAO_REDIS_URL",
    "CAO_GITHUB_CLIENT_SECRET",
    "CAO_SESSION_SECRET",
  ]) {
    const pattern = new RegExp(
      `name:\\s*'${setting}'[\\s\\S]*?value:\\s*'@Microsoft\\.KeyVault\\(SecretUri=`,
    );
    assert.match(main, pattern, `${setting} must use a Key Vault reference`);
  }
  assert.doesNotMatch(main, /secretUriWithVersion/);
});

test("Azure deployment includes a private manually triggered ingestion job", () => {
  assert.match(main, /module ingestion 'ingestion\.bicep'/);
  assert.match(main, /name:\s*'dashboard-ingest'/);
  assert.match(ingestion, /Microsoft\.App\/managedEnvironments@/);
  assert.match(ingestion, /infrastructureSubnetId:\s*infrastructureSubnetId/);
  assert.match(ingestion, /internal:\s*true/);
  assert.match(ingestion, /Microsoft\.App\/jobs@/);
  assert.match(ingestion, /triggerType:\s*'Manual'/);
  assert.match(ingestion, /command:\s*\['\/app\/cao-dashboard']/);
  assert.match(ingestion, /'ingest'/);
  assert.match(ingestion, /storageType:\s*'AzureFile'/);
  assert.match(ingestion, /keyVaultUrl:\s*'\$\{keyVaultUri}secrets\/cao-postgres-url'/);
  assert.match(ingestion, /keyVaultUrl:\s*'\$\{keyVaultUri}secrets\/cao-redis-url'/);
});

test("Azure templates do not output secrets or accept default-profile secret parameters", () => {
  const outputLines = main.split("\n").filter((line) => line.trim().startsWith("output "));
  assert.ok(outputLines.length > 0, "expected deterministic non-secret outputs");
  for (const line of outputLines) {
    const [, name] = line.trim().split(/\s+/);
    assert.doesNotMatch(name, /secret|token|connection|redis_url|accessKey|primaryKey/i);
  }
  assert.doesNotMatch(main, /param githubClientSecret/);
  assert.doesNotMatch(main, /param sessionSecret/);
  assert.doesNotMatch(main, /param redisConnectionString/);
  assert.doesNotMatch(main, /CAO_GITHUB_PAT|GITHUB_PAT|PERSONAL_ACCESS_TOKEN/i);
  assert.doesNotMatch(main, /CAO_AZURE_REQUIRE_HTTPS/);
});
