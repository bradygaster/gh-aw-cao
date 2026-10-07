targetScope = 'resourceGroup'

// Experimental Azure Functions deployment baseline for the Go dashboard server.
// Review and validate tenant-specific security, compliance, networking,
// monitoring, cost, rotation, and rollback requirements before live use.

@description('Azure region for all dashboard resources.')
param location string = resourceGroup().location

@description('Globally unique Function App name for the experimental Azure Functions dashboard profile.')
param functionAppName string

@description('Azure App Service plan name for the Function App.')
param hostingPlanName string = '${functionAppName}-plan'

@description('Application Insights component name.')
param applicationInsightsName string = '${functionAppName}-ai'

@description('Globally unique storage account name for Azure Functions runtime state.')
param storageAccountName string

@description('Globally unique Azure Container Registry name containing the Function App image.')
param containerRegistryName string

@description('Container repository containing the CAO Azure Functions runtime.')
param functionImageRepository string = 'cao-functions'

@description('Immutable or reviewed tag of the CAO Azure Functions runtime image.')
param functionImageTag string

@description('Key Vault name used for GitHub OAuth, session, PostgreSQL, and collection secrets.')
param keyVaultName string

@secure()
@description('TLS PostgreSQL URL shared by canonical dashboard storage and the isolated operational adapter.')
param postgresConnectionString string

@minValue(1)
@description('Maximum bytes retained in the disposable operational cache.')
param operationalCacheMaxBytes int = 33554432

@minValue(1)
@description('Maximum size of one disposable operational cache value.')
param operationalCacheMaxValueBytes int = 4194304

@minValue(1)
@description('Maximum number of disposable operational cache entries.')
param operationalCacheMaxEntries int = 1024

@minValue(1)
@description('Maximum bytes retained in protected operational records.')
param operationalProtectedMaxBytes int = 134217728

@minValue(1)
@description('Maximum number of protected operational records.')
param operationalProtectedMaxEntries int = 200000

@minValue(7)
@maxValue(3650)
@description('Number of days of canonical run history retained in PostgreSQL. Keep this at least as large as the published dashboard snapshot window.')
param postgresRunRetentionDays int = 45

@description('Public host names that Azure Front Door/App Service is allowed to forward to the Go dashboard handler.')
param allowedHosts array

@description('GitHub organizations whose active members are authorized.')
param githubAllowedOrganizations array

@description('GitHub teams whose active members are authorized, expressed as org/team-slug.')
param githubAllowedTeams array = []

@description('GitHub OAuth App client ID. Do not use a PAT; the server only supports the OAuth authorization-code flow.')
param githubClientId string

@secure()
@description('GitHub OAuth App client secret. It is written only to Key Vault and consumed by the Function App through a Key Vault reference.')
param githubClientSecret string

@secure()
@minLength(32)
@description('At least 32 characters of random session secret material used to encrypt server-side OAuth sessions.')
param sessionSecret string

@secure()
@description('Optional previous session secret retained during controlled key rotation until active sessions and pending revocations are drained.')
param previousSessionSecret string = ''

@description('Optional Log Analytics workspace resource ID for Application Insights. Leave empty to create classic component-only telemetry.')
param logAnalyticsWorkspaceResourceId string = ''

// Optional server collection profile.
//
// Leaving collectorImage empty deploys the default profile unchanged: the
// dashboard serves snapshots published by the Activity workflow and the server
// collects nothing. Supplying an image selects the alternative profile, in
// which this deployment collects evidence itself. The two profiles are
// alternatives, never layers.

@description('Optional container image running the collection role. Empty deploys no collection.')
param collectorImage string = ''

@description('GitHub App identifier whose installations define ingestion scope. Required with collectorImage.')
param collectorGithubAppId string = ''

@secure()
@description('GitHub App private key in PEM form. Required with collectorImage.')
param collectorPrivateKey string = ''

@secure()
@description('Shared secret verifying GitHub webhook deliveries. Required with collectorImage.')
param githubWebhookSecret string = ''

@description('GitHub logins permitted to run administrative operations.')
param githubAdminUsers array = []

@description('Control repository used for logical source discovery, in OWNER/REPOSITORY form.')
param collectorControlRepository string = ''

@minValue(1)
@description('Fixed number of PostgreSQL-backed collection workers.')
param collectorWorkerReplicas int = 1

@description('Evidence lake file share tier. Premium is provisioned SSD; Standard is IOPS-throttled by share size.')
@allowed([
  'Premium_LRS'
  'Premium_ZRS'
  'Standard_LRS'
  'Standard_ZRS'
])
param collectorLakeStorageSku string = 'Premium_LRS'

var collectionEnabled = !empty(collectorImage)

var tags = {
  workload: 'gh-aw-cao-dashboard'
  hostingMode: 'azure-functions'
}
var githubRedirectUri = 'https://${functionAppName}.azurewebsites.net/auth/callback'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enabledForTemplateDeployment: false
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }
}

resource githubClientSecretValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'github-oauth-client-secret'
  properties: {
    value: githubClientSecret
    contentType: 'GitHub OAuth client secret for CAO dashboard Azure Functions mode'
  }
}

resource sessionSecretValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cao-session-secret'
  properties: {
    value: sessionSecret
    contentType: 'CAO dashboard session encryption secret'
  }
}

resource previousSessionSecretValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(previousSessionSecret)) {
  parent: keyVault
  name: 'cao-session-secret-previous'
  properties: {
    value: previousSessionSecret
    contentType: 'Previous CAO dashboard session encryption secret retained during rotation'
  }
}

resource postgresConnectionStringValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cao-postgres-url'
  properties: {
    value: postgresConnectionString
    contentType: 'CAO dashboard PostgreSQL connection URL'
  }
}

resource collectorPrivateKeyValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (collectionEnabled) {
  parent: keyVault
  name: 'cao-collect-private-key'
  properties: {
    value: collectorPrivateKey
    contentType: 'GitHub App private key for the collection profile'
  }
}

resource githubWebhookSecretValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (collectionEnabled) {
  parent: keyVault
  name: 'cao-github-webhook-secret'
  properties: {
    value: githubWebhookSecret
    contentType: 'GitHub webhook shared secret'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: hostingPlanName
  location: location
  tags: tags
  kind: 'elastic'
  sku: {
    name: 'EP1'
    tier: 'ElasticPremium'
  }
  properties: {
    reserved: true
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: empty(logAnalyticsWorkspaceResourceId) ? null : logAnalyticsWorkspaceResourceId
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      alwaysOn: true
      minimumElasticInstanceCount: 1
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      linuxFxVersion: 'DOCKER|${registry.properties.loginServer}/${functionImageRepository}:${functionImageTag}'
      acrUseManagedIdentityCreds: true
      appSettings: concat([
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'custom'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storage.name
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'CAO_DASHBOARD_HOSTING'
          value: 'azure-functions'
        }
        {
          name: 'CAO_POLICY_PATH'
          value: '.github/workflows/cao.azure.json'
        }
        {
          name: 'CAO_DATABASE_QUERIES'
          value: '/app/queries/database.json'
        }
        {
          name: 'CAO_AZURE_ALLOWED_HOSTS'
          value: join(allowedHosts, ',')
        }
        {
          name: 'CAO_AZURE_REQUIRE_HTTPS'
          value: 'true'
        }
        {
          name: 'REDIS_NAMESPACE'
          value: 'azure-dashboard'
        }
        {
          name: 'CAO_OPERATIONAL_NAMESPACE'
          value: 'azure-dashboard-operational'
        }
        {
          name: 'CAO_OPERATIONAL_CACHE_MAX_BYTES'
          value: string(operationalCacheMaxBytes)
        }
        {
          name: 'CAO_OPERATIONAL_CACHE_MAX_VALUE_BYTES'
          value: string(operationalCacheMaxValueBytes)
        }
        {
          name: 'CAO_OPERATIONAL_CACHE_MAX_ENTRIES'
          value: string(operationalCacheMaxEntries)
        }
        {
          name: 'CAO_OPERATIONAL_PROTECTED_MAX_BYTES'
          value: string(operationalProtectedMaxBytes)
        }
        {
          name: 'CAO_OPERATIONAL_PROTECTED_MAX_ENTRIES'
          value: string(operationalProtectedMaxEntries)
        }
        {
          name: 'CAO_POSTGRES_URL'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-postgres-url)'
        }
        {
          name: 'CAO_POSTGRES_RUN_RETENTION_DAYS'
          value: string(postgresRunRetentionDays)
        }
        {
          name: 'CAO_GITHUB_CLIENT_ID'
          value: githubClientId
        }
        {
          name: 'CAO_GITHUB_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/github-oauth-client-secret)'
        }
        {
          name: 'CAO_GITHUB_REDIRECT_URL'
          value: githubRedirectUri
        }
        {
          name: 'CAO_GITHUB_ALLOWED_ORGS'
          value: join(githubAllowedOrganizations, ',')
        }
        {
          name: 'CAO_GITHUB_ALLOWED_TEAMS'
          value: join(githubAllowedTeams, ',')
        }
        {
          name: 'CAO_SESSION_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-session-secret)'
        }
      ], empty(previousSessionSecret) ? [] : [
        {
          name: 'CAO_SESSION_SECRET_PREVIOUS'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-session-secret-previous)'
        }
      ], !collectionEnabled ? [] : [
        // With collection configured the Function App admits webhook
        // deliveries into the collection queue. It performs no collection of
        // its own, so its per-request work stays constant.
        {
          name: 'CAO_GITHUB_WEBHOOK_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-github-webhook-secret)'
        }
        {
          name: 'CAO_GITHUB_ADMIN_USERS'
          value: join(githubAdminUsers, ',')
        }
        {
          name: 'CAO_COLLECT_APP_ID'
          value: collectorGithubAppId
        }
        {
          // The Function App verifies deliveries and enqueues work. It never
          // calls GitHub and never projects, so it is given no App private key
          // and no evidence lake: the internet-facing front end holds no
          // credential it cannot use.
          name: 'CAO_COLLECT_ADMIT_ONLY'
          value: 'true'
        }
        {
          name: 'CAO_COLLECT_CONTROL_REPOSITORY'
          value: collectorControlRepository
        }
      ])
    }
  }
  dependsOn: [
    githubClientSecretValue
    postgresConnectionStringValue
    sessionSecretValue
    previousSessionSecretValue
  ]
}

module functionRoles 'function-roles.bicep' = {
  name: 'function-managed-identity-roles'
  params: {
    storageAccountName: storage.name
    keyVaultName: keyVault.name
    containerRegistryName: registry.name
    functionPrincipalId: functionApp.identity.principalId
  }
}

module collection 'collector.bicep' = if (collectionEnabled) {
  name: 'collection-workers'
  params: {
    location: location
    tags: tags
    namePrefix: functionAppName
    collectorImage: collectorImage
    keyVaultUri: keyVault.properties.vaultUri
    keyVaultName: keyVault.name
    operationalNamespace: 'azure-dashboard-operational'
    operationalCacheMaxBytes: operationalCacheMaxBytes
    operationalCacheMaxValueBytes: operationalCacheMaxValueBytes
    operationalCacheMaxEntries: operationalCacheMaxEntries
    operationalProtectedMaxBytes: operationalProtectedMaxBytes
    operationalProtectedMaxEntries: operationalProtectedMaxEntries
    controlRepository: collectorControlRepository
    githubAppId: collectorGithubAppId
    workerReplicas: collectorWorkerReplicas
    lakeStorageSku: collectorLakeStorageSku
    applicationInsightsConnectionString: insights.properties.ConnectionString
    logAnalyticsWorkspaceResourceId: logAnalyticsWorkspaceResourceId
  }
  dependsOn: [
    collectorPrivateKeyValue
    postgresConnectionStringValue
  ]
}

output collectionEnabled bool = collectionEnabled
output containerRegistryLoginServer string = registry.properties.loginServer
output functionContainerImage string = '${registry.properties.loginServer}/${functionImageRepository}:${functionImageTag}'
output functionHostName string = functionApp.properties.defaultHostName
output githubOAuthRedirectUri string = githubRedirectUri
output keyVaultUri string = keyVault.properties.vaultUri
