import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bicep = await readFile(new URL('../../server/azure/main.bicep', import.meta.url), 'utf8');
const collector = await readFile(new URL('../../server/azure/collector.bicep', import.meta.url), 'utf8');
const functionRoles = await readFile(new URL('../../server/azure/function-roles.bicep', import.meta.url), 'utf8');
const generated = JSON.parse(await readFile(new URL('../../server/azure/main.json', import.meta.url), 'utf8'));
const profile = JSON.parse(await readFile(new URL('../../.github/workflows/cao.azure.json', import.meta.url), 'utf8'));
const network = await readFile(new URL('../../server/azure/network.bicep', import.meta.url), 'utf8');
const ingestion = await readFile(new URL('../../server/azure/ingestion.bicep', import.meta.url), 'utf8');
const dockerfile = await readFile(new URL('../../server/Dockerfile', import.meta.url), 'utf8');

test('Azure selects PostgreSQL operational storage without Redis', () => {
  assert.equal(profile.extends, 'cao.json');
  assert.deepEqual(profile['control-plane'].web.host, {
    target: { module: 'azure-functions' },
    'operational-store': { backend: 'postgres' },
  });
  assert.doesNotMatch(bicep, /Microsoft\.Cache|CAO_REDIS_URL|redisEnterprise|redisConnectionString/i);
  assert.doesNotMatch(collector, /redis-streams|cao-redis|CAO_REDIS_URL/i);
  assert.match(bicep, /name:\s*'CAO_POLICY_PATH'\s+value:\s*'\.github\/workflows\/cao\.azure\.json'/);
  assert.match(collector, /name:\s*'CAO_POLICY_PATH'\s+value:\s*'\/app\/\.github\/workflows\/cao\.azure\.json'/);
});

  test('Azure baseline provisions one shared telemetry pair and private PostgreSQL', () => {
    const count = (type) => generated.resources.filter((resource) => resource.type === type).length;
    assert.equal(count('Microsoft.Insights/components'), 1);
    assert.equal(count('Microsoft.OperationalInsights/workspaces'), 1);
    assert.equal(count('Microsoft.Storage/storageAccounts'), 1);
    assert.equal(count('Microsoft.App/managedEnvironments'), 1);
    assert.match(bicep, /WorkspaceResourceId:\s*workspace\.id/);
    assert.match(bicep, /workspaceId:\s*workspace\.id/);
    assert.match(bicep, /virtualNetworkSubnetId:\s*network\.outputs\.functionSubnetId/);
    assert.match(bicep, /infrastructureSubnetId:\s*network\.outputs\.containerSubnetId/);
    assert.match(bicep, /sslmode=verify-full/);
    assert.match(network, /Microsoft\.DBforPostgreSQL\/flexibleServers@/);
    assert.match(network, /publicNetworkAccess:\s*'Disabled'/);
    assert.match(network, /Microsoft\.Network\/privateDnsZones@/);
    assert.match(network, /backupRetentionDays:\s*7/);
    assert.doesNotMatch(network, /githubClient|sessionSecret|Microsoft\.Web\/sites@/);
    assert.doesNotMatch(collector, /resource environment '[^']+' = \{/);
  });

  test('Private ingestion and collection pull ACR images with managed identity', () => {
    assert.match(ingestion, /triggerType:\s*'Manual'/);
    assert.match(ingestion, /registries:\s*\[/);
    assert.match(ingestion, /server:\s*registry\.properties\.loginServer/);
    assert.match(ingestion, /identity:\s*identity\.id/);
    assert.match(ingestion, /keyVaultUrl:.*cao-postgres-url/);
    assert.match(ingestion, /'--redis-namespace'\s+'azure-dashboard'/);
    assert.match(ingestion, /dependsOn:\s*\[roles\]/);
    assert.equal((collector.match(/registries:\s*registries/g) ?? []).length, 2);
    assert.equal((collector.match(/dependsOn:\s*\[roles\]/g) ?? []).length, 2);
    assert.equal((collector.match(/'--database-queries', '\/app\/queries\/database.json'/g) ?? []).length, 2);
    assert.match(collector, /name:\s*'CAO_COLLECT_CATALOG_ROOT'\s+value:\s*'\/app\/catalog'/);
    assert.match(collector, /name:\s*'CAO_POSTGRES_RUN_RETENTION_DAYS'/);
  });

  test('Azure image inputs are explicit and default Docker target remains hosted dashboard', () => {
    const stages = dockerfile.split('\n').filter((line) => line.startsWith('FROM '));
    assert.equal(stages.at(-1), 'FROM dashboard-runtime AS final');
    assert.doesNotMatch(dockerfile, /cao\.mjs download/);
    assert.match(dockerfile, /ARG CAO_INGEST_SOURCE\nRUN test -n "\$\{CAO_INGEST_SOURCE\}"/);
    assert.match(dockerfile, /COPY --chown=cao:cao \$\{CAO_INGEST_SOURCE\}\/ \/data\//);
    assert.match(dockerfile, /FROM dashboard-runtime AS azure-empty-ingest-runtime/);
    assert.match(dockerfile, /COPY --chown=cao:cao server\/azure\/empty-data\/ \/data\//);
  });
test('Azure shares PostgreSQL and operational budgets across dashboard and collection roles', () => {
  for (const source of [bicep, collector]) {
    assert.match(source, /name:\s*'CAO_POSTGRES_URL'\s+secretRef:|'CAO_POSTGRES_URL'[\s\S]*?cao-postgres-url/);
    assert.match(source, /CAO_OPERATIONAL_CACHE_MAX_BYTES/);
    assert.match(source, /CAO_OPERATIONAL_CACHE_MAX_VALUE_BYTES/);
    assert.match(source, /CAO_OPERATIONAL_CACHE_MAX_ENTRIES/);
    assert.match(source, /CAO_OPERATIONAL_PROTECTED_MAX_BYTES/);
    assert.match(source, /CAO_OPERATIONAL_PROTECTED_MAX_ENTRIES/);
  }
  assert.equal(generated.parameters.operationalCacheMaxBytes.defaultValue, 33554432);
  assert.equal(generated.parameters.operationalCacheMaxValueBytes.defaultValue, 4194304);
  assert.equal(generated.parameters.operationalCacheMaxEntries.defaultValue, 1024);
  assert.equal(generated.parameters.operationalProtectedMaxBytes.defaultValue, 134217728);
  assert.equal(generated.parameters.operationalProtectedMaxEntries.defaultValue, 200000);
  assert.ok(!('redisMaxBytes' in generated.parameters));
});

test('Azure collection uses fixed PostgreSQL-backed workers', () => {
  assert.match(collector, /param workerReplicas int = 1/);
  assert.match(collector, /minReplicas:\s*workerReplicas/);
  assert.match(collector, /maxReplicas:\s*workerReplicas/);
  assert.doesNotMatch(collector, /rules:\s*\[/);
  assert.doesNotMatch(collector, /taskStreamKey|streamKey|consumerGroup/);
});

test('Azure dashboard Bicep does not output secrets or PAT-based configuration', () => {
  const outputLines = bicep.split('\n').filter((line) => line.trim().startsWith('output '));
  assert.ok(outputLines.length > 0, 'expected deterministic non-secret outputs');
  for (const line of outputLines) {
    const [, name] = line.trim().split(/\s+/);
    assert.doesNotMatch(name, /secret|token|connection|accessKey|primaryKey/i);
  }
  assert.doesNotMatch(bicep, /CAO_GITHUB_PAT|GITHUB_PAT|PERSONAL_ACCESS_TOKEN/i);
  assert.match(bicep, /OAuth authorization-code flow/);
});

test('Azure dashboard Bicep keeps secret-bearing settings in Key Vault', () => {
  assert.match(bicep, /resource keyVault 'Microsoft\.KeyVault\/vaults@/);
  assert.match(bicep, /enableRbacAuthorization:\s*true/);
  assert.match(bicep, /enableSoftDelete:\s*true/);
  assert.match(bicep, /enablePurgeProtection:\s*true/);
  assert.match(bicep, /enabledForTemplateDeployment:\s*false/);
  assert.match(bicep, /param previousSessionSecret string = ''/);
  assert.match(bicep, /name:\s*'cao-session-secret-previous'/);
  assert.match(bicep, /identity:\s*{\s*type:\s*'SystemAssigned'/);
  assert.match(functionRoles, /Key Vault Secrets User/);

  for (const setting of ['CAO_POSTGRES_URL', 'CAO_GITHUB_CLIENT_SECRET', 'CAO_SESSION_SECRET']) {
    const pattern = new RegExp(`name:\\s*'${setting}'[\\s\\S]*?value:\\s*'@Microsoft\\.KeyVault\\(SecretUri=`);
    assert.match(bicep, pattern, `${setting} must use a Key Vault reference`);
  }
  assert.match(bicep, /name:\s*'AzureWebJobsStorage__accountName'/);
  assert.match(bicep, /name:\s*'AzureWebJobsStorage__credential'\s+value:\s*'managedidentity'/);
  assert.match(bicep, /allowSharedKeyAccess:\s*false/);
  assert.match(functionRoles, /Storage Blob Data Owner/);
  assert.match(functionRoles, /Storage Queue Data Contributor/);
  assert.match(functionRoles, /Storage Table Data Contributor/);
  assert.match(functionRoles, /AcrPull/);
  assert.match(
    functionRoles,
    /guid\(storage\.id,\s*functionPrincipalId,\s*'Storage Blob Data Owner'\)/,
    'storage role assignment IDs must change when the Function App managed identity is replaced',
  );
  assert.match(
    functionRoles,
    /guid\(keyVault\.id,\s*functionPrincipalId,\s*'Key Vault Secrets User'\)/,
    'Key Vault role assignment IDs must change when the Function App managed identity is replaced',
  );
  assert.match(
    functionRoles,
    /guid\(registry\.id,\s*functionPrincipalId,\s*'AcrPull'\)/,
    'registry role assignment IDs must change when the Function App managed identity is replaced',
  );
  assert.doesNotMatch(bicep, /secretUriWithVersion/, 'Key Vault references must follow the current secret version for rotation');

  assert.match(bicep, /httpsOnly:\s*true/);
  assert.match(bicep, /kind:\s*'functionapp,linux,container'/);
  assert.match(bicep, /linuxFxVersion:\s*'DOCKER\|\$\{registry\.properties\.loginServer\}/);
  assert.match(bicep, /acrUseManagedIdentityCreds:\s*true/);
  assert.match(bicep, /name:\s*'FUNCTIONS_WORKER_RUNTIME'\s+value:\s*'custom'/);
  assert.match(bicep, /name:\s*'WEBSITES_PORT'\s+value:\s*'8080'/);
  assert.match(bicep, /name:\s*'WEBSITES_ENABLE_APP_SERVICE_STORAGE'\s+value:\s*'false'/);
  assert.match(bicep, /name:\s*'CAO_DATABASE_QUERIES'\s+value:\s*'\/app\/queries\/database\.json'/);
  assert.match(bicep, /name:\s*'CAO_GITHUB_ALLOWED_USERS'\s+value:\s*join\(githubAllowedUsers,\s*','\)/);
  assert.match(bicep, /alwaysOn:\s*true/);
  assert.match(bicep, /minimumElasticInstanceCount:\s*1/);
  assert.match(bicep, /ftpsState:\s*'Disabled'/);
  assert.match(bicep, /allowBlobPublicAccess:\s*false/);
  assert.match(bicep, /supportsHttpsTrafficOnly:\s*true/);
});
