targetScope = 'resourceGroup'

// Staging-ready Azure Functions deployment for the Go dashboard server.
// Tenant-specific security, compliance, cost, monitoring, and availability
// requirements still require review before live use.

@description('Azure region for all dashboard resources.')
param location string = resourceGroup().location

@description('Globally unique Function App name.')
param functionAppName string

@description('Azure App Service plan name for the Function App.')
param hostingPlanName string = '${functionAppName}-plan'

@description('Linux App Service plan SKU for the Function App.')
param hostingPlanSkuName string = 'FC1'

@description('Linux App Service plan tier for the Function App.')
param hostingPlanSkuTier string = 'FlexConsumption'

@description('Globally unique storage account name for Functions state and the ingestion artifact container.')
param storageAccountName string

@description('Existing Key Vault name created by bootstrap.bicep.')
param keyVaultName string

@description('Azure Managed Redis cache name.')
param redisEnterpriseName string

@description('PostgreSQL Flexible Server name.')
param postgresServerName string

@description('PostgreSQL administrator login.')
param postgresAdministratorLogin string = 'caoadmin'

@description('Virtual network name.')
param virtualNetworkName string = '${functionAppName}-vnet'

@description('Immutable CAO server image used by the private ingestion job.')
param ingestionImage string

@description('Microsoft Entra object ID allowed to upload verified ingestion artifacts.')
param deployerObjectId string

@allowed([
  'Balanced_B0'
  'Balanced_B1'
  'Balanced_B3'
  'Balanced_B5'
  'Balanced_B10'
  'MemoryOptimized_M10'
])
@description('Redis SKU. Size for operational caches, queues, sessions, and rate limits.')
param redisSkuName string = 'Balanced_B0'

@description('PostgreSQL compute SKU.')
param postgresSkuName string = 'Standard_B1ms'

@description('PostgreSQL compute tier.')
param postgresSkuTier string = 'Burstable'

@minValue(32)
@description('PostgreSQL storage size in GiB.')
param postgresStorageSizeGB int = 32

@description('Public host names that App Service is allowed to forward to the Go handler.')
param allowedHosts array

@description('GitHub organizations whose active members are authorized.')
param githubAllowedOrganizations array = []

@description('GitHub teams whose active members are authorized, expressed as org/team-slug.')
param githubAllowedTeams array = []

@description('GitHub OAuth App client ID.')
param githubClientId string

@description('Reference the optional previous session secret during a controlled rotation.')
param usePreviousSessionSecret bool = false

@description('Optional Log Analytics workspace resource ID for Application Insights and Container Apps logs.')
param logAnalyticsWorkspaceResourceId string = ''

@description('Optional container image running the server collection role. Empty keeps the default artifact-ingestion profile.')
param collectorImage string = ''

@description('GitHub App identifier whose installations define ingestion scope. Required with collectorImage.')
param collectorGithubAppId string = ''

@description('GitHub logins permitted to run administrative operations.')
param githubAdminUsers array = []

@description('Control repository used for logical source discovery, in OWNER/REPOSITORY form.')
param collectorControlRepository string = ''

@description('Maximum number of collection workers.')
param collectorMaximumWorkers int = 20

@allowed([
  'Premium_LRS'
  'Premium_ZRS'
  'Standard_LRS'
  'Standard_ZRS'
])
@description('Evidence lake file share tier for the optional collection profile.')
param collectorLakeStorageSku string = 'Premium_LRS'

var collectionEnabled = !empty(collectorImage)
var redisNamespace = 'azure-dashboard'
var tags = {
  workload: 'gh-aw-cao-dashboard'
  hostingMode: 'azure-functions'
}
var githubRedirectUri = 'https://${functionAppName}.azurewebsites.net/auth/callback'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: virtualNetworkName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
  }
}

resource functionsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'functions'
  properties: {
    addressPrefix: '10.42.0.0/24'
    delegations: [
      {
        name: 'web'
        properties: {
          serviceName: 'Microsoft.Web/serverFarms'
        }
      }
    ]
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'postgres'
  properties: {
    addressPrefix: '10.42.1.0/24'
    delegations: [
      {
        name: 'postgres'
        properties: {
          serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
        }
      }
    ]
  }
  dependsOn: [
    functionsSubnet
  ]
}

resource privateEndpointsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'private-endpoints'
  properties: {
    addressPrefix: '10.42.2.0/24'
    privateEndpointNetworkPolicies: 'Disabled'
  }
  dependsOn: [
    postgresSubnet
  ]
}

resource ingestionSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: network
  name: 'ingestion'
  properties: {
    addressPrefix: '10.42.4.0/23'
  }
  dependsOn: [
    privateEndpointsSubnet
  ]
}

resource collectorsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = if (collectionEnabled) {
  parent: network
  name: 'collectors'
  properties: {
    addressPrefix: '10.42.6.0/23'
  }
  dependsOn: [
    ingestionSubnet
  ]
}

resource postgresPrivateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresPrivateDns
  name: '${virtualNetworkName}-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

module postgres 'postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    tags: tags
    serverName: postgresServerName
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: keyVault.getSecret('cao-postgres-admin-password')
    delegatedSubnetResourceId: postgresSubnet.id
    privateDnsZoneResourceId: postgresPrivateDns.id
    keyVaultName: keyVault.name
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    storageSizeGB: postgresStorageSizeGB
  }
  dependsOn: [
    postgresPrivateDnsLink
  ]
}

resource redisEnterprise 'Microsoft.Cache/redisEnterprise@2025-07-01' = {
  name: redisEnterpriseName
  location: location
  tags: tags
  sku: {
    name: redisSkuName
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource redisDatabase 'Microsoft.Cache/redisEnterprise/databases@2025-07-01' = {
  parent: redisEnterprise
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'EnterpriseCluster'
    evictionPolicy: 'NoEviction'
    modules: [
      { name: 'RedisJSON' }
      { name: 'RediSearch' }
    ]
  }
}

resource redisPrivateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.redisenterprise.cache.azure.net'
  location: 'global'
  tags: tags
}

resource redisPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: redisPrivateDns
  name: '${virtualNetworkName}-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: network.id
    }
  }
}

resource redisPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${redisEnterpriseName}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointsSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'redis'
        properties: {
          privateLinkServiceId: redisEnterprise.id
          groupIds: [
            'redisEnterprise'
          ]
        }
      }
    ]
  }
}

resource redisPrivateDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: redisPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'redis'
        properties: {
          privateDnsZoneId: redisPrivateDns.id
        }
      }
    ]
  }
}

resource redisConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cao-redis-url'
  properties: {
    value: 'rediss://:${uriComponent(redisDatabase.listKeys().primaryKey)}@${redisEnterprise.properties.hostName}:10000/0'
    contentType: 'CAO dashboard Azure Managed Redis URL'
  }
}

resource collectorRedisPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (collectionEnabled) {
  parent: keyVault
  name: 'cao-redis-password'
  properties: {
    value: redisDatabase.listKeys().primaryKey
    contentType: 'Redis access key for the CAO collection autoscaler'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource ingestionContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'dashboard-ingest'
  properties: {
    publicAccess: 'None'
  }
}

resource functionDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'function-deployments'
  properties: {
    publicAccess: 'None'
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: hostingPlanName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: hostingPlanSkuName
    tier: hostingPlanSkuTier
  }
  properties: {
    reserved: true
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${functionAppName}-ai'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: empty(logAnalyticsWorkspaceResourceId) ? null : logAnalyticsWorkspaceResourceId
  }
}

resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${functionAppName}-identity'
  location: location
  tags: tags
}

resource functionSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionIdentity.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionStorageBlobOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, 'Storage Blob Data Owner')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
    )
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionStorageQueueContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, 'Storage Queue Data Contributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
    )
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionStorageTableContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, 'Storage Table Data Contributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
    )
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerArtifactContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ingestionContainer.id, deployerObjectId, 'Storage Blob Data Contributor')
  scope: ingestionContainer
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
    )
    principalId: deployerObjectId
    principalType: 'User'
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    virtualNetworkSubnetId: functionsSubnet.id
    keyVaultReferenceIdentity: functionIdentity.id
    httpsOnly: true
    clientAffinityEnabled: false
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${functionDeploymentContainer.name}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: functionIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 10
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'custom'
        version: '1.0'
      }
    }
    siteConfig: {
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      vnetRouteAllEnabled: true
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
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: insights.properties.ConnectionString
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: storage.properties.primaryEndpoints.blob
        }
        {
          name: 'AzureWebJobsStorage__queueServiceUri'
          value: storage.properties.primaryEndpoints.queue
        }
        {
          name: 'AzureWebJobsStorage__tableServiceUri'
          value: storage.properties.primaryEndpoints.table
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'AzureWebJobsStorage__clientId'
          value: functionIdentity.properties.clientId
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
          name: 'CAO_AZURE_ALLOWED_HOSTS'
          value: join(allowedHosts, ',')
        }
        {
          name: 'CAO_AZURE_DASHBOARD_QUERIES'
          value: 'site/src/agent/queries.generated.json'
        }
        {
          name: 'CAO_DATABASE_QUERIES'
          value: 'queries/database.json'
        }
        {
          name: 'CAO_POSTGRES_URL'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-postgres-url)'
        }
        {
          name: 'CAO_REDIS_NAMESPACE'
          value: redisNamespace
        }
        {
          name: 'CAO_REDIS_URL'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-redis-url)'
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
      ], usePreviousSessionSecret ? [
        {
          name: 'CAO_SESSION_SECRET_PREVIOUS'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/cao-session-secret-previous)'
        }
      ] : [], !collectionEnabled ? [] : [
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
    functionSecretsUser
    functionStorageBlobOwner
    functionStorageQueueContributor
    functionStorageTableContributor
    postgres
    redisConnectionString
    redisPrivateDnsGroup
  ]
}

module ingestion 'ingestion.bicep' = {
  name: 'ingestion'
  params: {
    location: location
    tags: tags
    namePrefix: functionAppName
    infrastructureSubnetId: ingestionSubnet.id
    keyVaultName: keyVault.name
    keyVaultUri: keyVault.properties.vaultUri
    storageAccountName: storage.name
    artifactContainerName: ingestionContainer.name
    ingestionImage: ingestionImage
    redisNamespace: redisNamespace
    applicationInsightsConnectionString: insights.properties.ConnectionString
    logAnalyticsWorkspaceResourceId: logAnalyticsWorkspaceResourceId
  }
  dependsOn: [
    postgres
    redisConnectionString
    redisPrivateDnsGroup
  ]
}

module collection 'collector.bicep' = if (collectionEnabled) {
  name: 'collection-workers'
  params: {
    location: location
    tags: tags
    namePrefix: functionAppName
    infrastructureSubnetId: collectorsSubnet.id
    collectorImage: collectorImage
    keyVaultUri: keyVault.properties.vaultUri
    keyVaultName: keyVault.name
    redisHost: redisEnterprise.properties.hostName
    redisNamespace: redisNamespace
    controlRepository: collectorControlRepository
    githubAppId: collectorGithubAppId
    maximumWorkers: collectorMaximumWorkers
    lakeStorageSku: collectorLakeStorageSku
    applicationInsightsConnectionString: insights.properties.ConnectionString
    logAnalyticsWorkspaceResourceId: logAnalyticsWorkspaceResourceId
  }
  dependsOn: [
    collectorRedisPassword
    redisConnectionString
    redisPrivateDnsGroup
  ]
}

output collectionEnabled bool = collectionEnabled
output functionHostName string = functionApp.properties.defaultHostName
output githubOAuthRedirectUri string = githubRedirectUri
output ingestionJobName string = ingestion.outputs.jobName
output ingestionContainerName string = ingestionContainer.name
output keyVaultUri string = keyVault.properties.vaultUri
output postgresHostName string = postgres.outputs.hostName
output redisEnterpriseHostName string = redisEnterprise.properties.hostName
output redisDatabaseName string = redisDatabase.name
