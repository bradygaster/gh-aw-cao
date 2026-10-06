import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bicep = await readFile(new URL('../../server/azure/main.bicep', import.meta.url), 'utf8');
const collector = await readFile(new URL('../../server/azure/collector.bicep', import.meta.url), 'utf8');
const generated = JSON.parse(await readFile(new URL('../../server/azure/main.json', import.meta.url), 'utf8'));

test('Azure shares one positive Redis memory budget across dashboard and collection roles', () => {
  for (const source of [bicep, collector]) {
    assert.match(source, /@minValue\(1\)\s*@description\('[^']*'\)\s*param redisMaxBytes int = 200000000/);
    assert.match(source, /name:\s*'CAO_REDIS_MAX_BYTES'\s+value:\s*string\(redisMaxBytes\)/);
  }
  assert.match(bicep, /redisMaxBytes:\s*redisMaxBytes/);
  assert.equal(generated.parameters.redisMaxBytes.defaultValue, 200000000);
  assert.equal(generated.parameters.redisMaxBytes.minValue, 1);
  const collection = generated.resources.find((resource) => resource.type === 'Microsoft.Resources/deployments' && resource.name === 'collection-workers');
  assert.equal(collection.properties.parameters.redisMaxBytes.value, "[parameters('redisMaxBytes')]");
  assert.equal(collection.properties.template.parameters.redisMaxBytes.defaultValue, 200000000);
  assert.equal(collection.properties.template.parameters.redisMaxBytes.minValue, 1);
});

test('Azure dashboard Bicep defaults to conditional Azure Managed Redis with TLS app settings', () => {
  assert.match(bicep, /Experimental Azure Functions deployment baseline/);
  assert.match(bicep, /Review and validate tenant-specific security, compliance, networking/);
  assert.match(bicep, /param redisProvider string = 'azure-managed-redis'/);
  assert.match(bicep, /param externalRedisHost string = ''/);
  assert.match(bicep, /param externalRedisPort int = 10000/);
  assert.match(bicep, /var resolvedRedisHost = managedRedisEnabled \? redisEnterprise!\.properties\.hostName : externalRedisHost/);
  assert.match(bicep, /Microsoft\.Cache\/redisEnterprise@/);
  assert.match(bicep, /resource redisEnterprise '[^']+' = if \(managedRedisEnabled\)/);
  assert.match(bicep, /resource redisDatabase '[^']+' = if \(managedRedisEnabled\)/);
  assert.doesNotMatch(bicep, /modules:\s*\[/);
  assert.match(bicep, /param redisSkuName string = 'Balanced_B0'/);
  assert.match(bicep, /clientProtocol:\s*'Encrypted'/);
  assert.match(bicep, /publicNetworkAccess:\s*'Disabled'/);
  assert.match(bicep, /CAO_REDIS_URL/);
  assert.match(bicep, /@Microsoft\.KeyVault\(SecretUri=/);
  assert.match(bicep, /CAO_DASHBOARD_HOSTING[\s\S]*azure-functions/);
  assert.equal(generated.parameters.redisProvider.defaultValue, 'azure-managed-redis');
  assert.deepEqual(generated.parameters.redisProvider.allowedValues, ['azure-managed-redis', 'external']);
  assert.equal(generated.parameters.externalRedisHost.defaultValue, '');
  assert.equal(generated.parameters.externalRedisPort.defaultValue, 10000);
  const redisResources = generated.resources.filter((resource) => resource.type.startsWith('Microsoft.Cache/redisEnterprise'));
  assert.equal(redisResources.length, 2);
  for (const resource of redisResources) {
    assert.equal(resource.condition, "[variables('managedRedisEnabled')]");
  }
});

test('Azure dashboard Bicep does not output secrets or PAT-based configuration', () => {
  const outputLines = bicep.split('\n').filter((line) => line.trim().startsWith('output '));
  assert.ok(outputLines.length > 0, 'expected deterministic non-secret outputs');
  for (const line of outputLines) {
    const [, name] = line.trim().split(/\s+/);
    assert.doesNotMatch(name, /secret|token|connection|redis_url|accessKey|primaryKey/i);
  }
  assert.doesNotMatch(bicep, /CAO_GITHUB_PAT|GITHUB_PAT|PERSONAL_ACCESS_TOKEN/i);
  assert.match(bicep, /OAuth authorization-code flow/);
  assert.match(bicep, /output redisProvider string = redisProvider/);
  assert.match(bicep, /output redisHostName string = resolvedRedisHost/);
  assert.match(bicep, /output redisPort int = resolvedRedisPort/);
  assert.doesNotMatch(bicep, /output redisEnterpriseHostName|output redisDatabaseName/);
  assert.deepEqual(
    Object.keys(generated.outputs).sort(),
    ['collectionEnabled', 'functionHostName', 'githubOAuthRedirectUri', 'keyVaultUri', 'redisHostName', 'redisPort', 'redisProvider'].sort(),
  );
  assert.equal(
    generated.outputs.redisHostName.value,
    "[if(variables('managedRedisEnabled'), reference(resourceId('Microsoft.Cache/redisEnterprise', parameters('redisEnterpriseName')), '2024-11-01').hostName, parameters('externalRedisHost'))]",
  );
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
  assert.match(bicep, /Key Vault Secrets User/);

  for (const setting of ['AzureWebJobsStorage', 'CAO_REDIS_URL', 'CAO_GITHUB_CLIENT_SECRET', 'CAO_SESSION_SECRET']) {
    const pattern = new RegExp(`name:\\s*'${setting}'[\\s\\S]*?value:\\s*'@Microsoft\\.KeyVault\\(SecretUri=`);
    assert.match(bicep, pattern, `${setting} must use a Key Vault reference`);
  }
  assert.doesNotMatch(bicep, /secretUriWithVersion/, 'Key Vault references must follow the current secret version for rotation');

  assert.match(bicep, /httpsOnly:\s*true/);
  assert.match(bicep, /alwaysOn:\s*true/);
  assert.match(bicep, /minimumElasticInstanceCount:\s*1/);
  assert.match(bicep, /ftpsState:\s*'Disabled'/);
  assert.match(bicep, /allowBlobPublicAccess:\s*false/);
  assert.match(bicep, /supportsHttpsTrafficOnly:\s*true/);
});

test('Azure collection scaler uses ACL username and password without exposing the worker URL', () => {
  assert.match(bicep, /param collectorRedisUsername string = ''/);
  assert.match(bicep, /var resolvedCollectorRedisUsername = managedRedisEnabled && empty\(collectorRedisUsername\) \? 'default' : collectorRedisUsername/);
  assert.match(bicep, /name:\s*'cao-redis-username'/);
  assert.match(bicep, /name:\s*'cao-redis-password'/);
  assert.match(bicep, /redisHost:\s*resolvedRedisHost/);
  assert.match(bicep, /redisPort:\s*resolvedRedisPort/);
  assert.match(collector, /secretRef:\s*'cao-redis-username'\s+triggerParameter:\s*'username'/);
  assert.match(collector, /secretRef:\s*'cao-redis-password'\s+triggerParameter:\s*'password'/);
  assert.match(collector, /name:\s*'CAO_REDIS_URL'\s+secretRef:\s*'cao-redis-url'/);
  assert.match(collector, /enableTLS:\s*'true'/);
  assert.doesNotMatch(collector, /disableTLS|skipTLS|insecure/i);
  const collection = generated.resources.find((resource) => resource.type === 'Microsoft.Resources/deployments' && resource.name === 'collection-workers');
  assert.match(collection.properties.parameters.redisHost, /managedRedisEnabled/);
  assert.match(collection.properties.parameters.redisHost, /externalRedisHost/);
  assert.equal(collection.properties.parameters.redisPort.value, "[variables('resolvedRedisPort')]");
  assert.equal(collection.properties.template.parameters.redisHost.type, 'string');
  assert.equal(collection.properties.template.parameters.redisPort.type, 'int');
});
