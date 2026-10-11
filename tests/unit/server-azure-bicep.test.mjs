import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bicep = await readFile(new URL('../../server/azure/main.bicep', import.meta.url), 'utf8');
const collector = await readFile(new URL('../../server/azure/collector.bicep', import.meta.url), 'utf8');
const functionRoles = await readFile(new URL('../../server/azure/function-roles.bicep', import.meta.url), 'utf8');
const generated = JSON.parse(await readFile(new URL('../../server/azure/main.json', import.meta.url), 'utf8'));
const resources = Object.values(generated.resources);
const profile = JSON.parse(await readFile(new URL('../../.github/workflows/cao.azure.json', import.meta.url), 'utf8'));
const network = await readFile(new URL('../../server/azure/network.bicep', import.meta.url), 'utf8');
const ingestion = await readFile(new URL('../../server/azure/ingestion.bicep', import.meta.url), 'utf8');
const dockerfile = await readFile(new URL('../../server/Dockerfile', import.meta.url), 'utf8');
const privateIngress = JSON.parse(await readFile(new URL('../../server/azure/private-ingress.json', import.meta.url), 'utf8'));

test('Azure ingress fails closed and only provisions explicitly supplied private connectivity', () => {
  assert.equal(generated.parameters.functionPublicNetworkAccess.defaultValue, 'Disabled');
  assert.deepEqual(generated.parameters.functionPublicNetworkAccess.allowedValues, ['Disabled', 'Enabled']);
  assert.deepEqual(generated.parameters.functionAccessRestrictions.defaultValue, []);
  const app = resources.find((resource) => resource.type === 'Microsoft.Web/sites');
  assert.equal(app.properties.publicNetworkAccess, "[parameters('functionPublicNetworkAccess')]");
  assert.equal(app.properties.siteConfig.ipSecurityRestrictionsDefaultAction, 'Deny');
  assert.equal(app.properties.siteConfig.scmIpSecurityRestrictionsDefaultAction, 'Deny');
  assert.equal(app.properties.siteConfig.scmIpSecurityRestrictionsUseMain, true);
  assert.equal(app.properties.siteConfig.ipSecurityRestrictions, "[parameters('functionAccessRestrictions')]");
  const module = resources.find((resource) => resource.name === 'dashboard-private-ingress');
  assert.equal(generated.parameters.privateIngress.nullable, true);
  assert.equal(generated.parameters.privateIngress.$ref, '#/definitions/privateIngressConfiguration');
  assert.deepEqual(generated.definitions.privateIngressConfiguration.properties, {
    subnetResourceId: { type: 'string', minLength: 1 },
    privateDnsZoneResourceId: { type: 'string', minLength: 1 },
    location: { type: 'string', minLength: 1 },
  });
  assert.equal(module.condition, "[not(equals(parameters('privateIngress'), null()))]");
  assert.equal(module.subscriptionId, "[split(parameters('privateIngress').subnetResourceId, '/')[2]]");
  assert.equal(module.resourceGroup, "[split(parameters('privateIngress').subnetResourceId, '/')[4]]");
  assert.equal(module.properties.expressionEvaluationOptions.scope, 'inner');
  assert.equal(module.properties.mode, 'Incremental');
  assert.equal(module.properties.parameters.functionAppResourceId.value, "[resourceId('Microsoft.Web/sites', parameters('functionAppName'))]");
  assert.deepEqual(module.dependsOn, ['functionApp']);
  for (const property of ['subnetResourceId', 'privateDnsZoneResourceId', 'location']) {
    assert.equal(module.properties.parameters[property].value, `[parameters('privateIngress').${property}]`);
  }
  assert.deepEqual(module.properties.template, privateIngress);
});

test('Standalone private ingress cannot rewrite the app, network, identities or DNS links', () => {
  assert.deepEqual(privateIngress.resources.map((resource) => resource.type).sort(), [
    'Microsoft.Network/privateEndpoints',
    'Microsoft.Network/privateEndpoints/privateDnsZoneGroups',
  ]);
  for (const parameter of ['functionAppResourceId', 'privateEndpointName', 'subnetResourceId', 'privateDnsZoneResourceId', 'location']) {
    assert.ok(!('defaultValue' in privateIngress.parameters[parameter]));
  }
  const endpoint = privateIngress.resources.find((resource) => resource.type === 'Microsoft.Network/privateEndpoints');
  assert.equal(endpoint.location, "[parameters('location')]");
  assert.equal(endpoint.name, "[parameters('privateEndpointName')]");
  assert.equal(endpoint.properties.subnet.id, "[parameters('subnetResourceId')]");
  assert.deepEqual(endpoint.properties.privateLinkServiceConnections[0].properties.groupIds, ['sites']);
  assert.equal(endpoint.properties.privateLinkServiceConnections[0].properties.privateLinkServiceId, "[parameters('functionAppResourceId')]");
  const zoneGroup = privateIngress.resources.find((resource) => resource.type.endsWith('/privateDnsZoneGroups'));
  assert.equal(zoneGroup.properties.privateDnsZoneConfigs[0].properties.privateDnsZoneId, "[parameters('privateDnsZoneResourceId')]");
  assert.equal(zoneGroup.name, "[format('{0}/{1}', parameters('privateEndpointName'), 'app-service')]");
  assert.deepEqual(zoneGroup.dependsOn, ["[resourceId('Microsoft.Network/privateEndpoints', parameters('privateEndpointName'))]"]);
  assert.equal(privateIngress.outputs.privateEndpointId.value, "[resourceId('Microsoft.Network/privateEndpoints', parameters('privateEndpointName'))]");
});

test('Every Azure role explicitly preserves the run window for linked evidence', () => {
  for (const source of [bicep, ingestion, collector]) {
    assert.match(source, /name:\s*'CAO_POSTGRES_LINKED_RETENTION_DAYS'\s+value:\s*string\(postgresRunRetentionDays\)/);
  }
  const app = resources.find((resource) => resource.type === 'Microsoft.Web/sites');
  for (const setting of ['CAO_POSTGRES_RUN_RETENTION_DAYS', 'CAO_POSTGRES_LINKED_RETENTION_DAYS']) {
    assert.ok(app.properties.siteConfig.appSettings.includes(`createObject('name', '${setting}', 'value', string(parameters('postgresRunRetentionDays')))`));
  }
  let checkedContainers = 0;
  for (const name of ['snapshot-ingestion', 'collection-workers']) {
    const module = resources.find((resource) => resource.name === name);
    assert.equal(module.properties.parameters.postgresRunRetentionDays.value, "[parameters('postgresRunRetentionDays')]");
    const template = module.properties.template;
    const workers = Object.values(template.resources).filter((resource) =>
      ['Microsoft.App/jobs', 'Microsoft.App/containerApps'].includes(resource.type));
    assert.equal(workers.length, name === 'snapshot-ingestion' ? 1 : 2);
    for (const worker of workers) {
      for (const container of worker.properties.template.containers) {
        const environment = Array.isArray(container.env) ? container.env : template.variables.collectionEnvironment;
        if (!Array.isArray(container.env)) {
          assert.equal(container.env, "[variables('collectionEnvironment')]");
        }
        for (const setting of ['CAO_POSTGRES_RUN_RETENTION_DAYS', 'CAO_POSTGRES_LINKED_RETENTION_DAYS']) {
          assert.deepEqual(environment.filter((entry) => entry.name === setting), [{
            name: setting,
            value: "[string(parameters('postgresRunRetentionDays'))]",
          }], `${container.name} must preserve ${setting}`);
        }
        checkedContainers++;
      }
    }
  }
  assert.equal(checkedContainers, 3, 'ingestion, collector and backfill must each receive retention settings');
});

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
    const count = (type) => resources.filter((resource) => resource.type === type).length;
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
