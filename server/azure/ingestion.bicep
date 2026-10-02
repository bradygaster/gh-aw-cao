@description('Azure region for ingestion resources.')
param location string

@description('Resource tags.')
param tags object

@description('Name prefix for ingestion resources.')
param namePrefix string

@description('Subnet resource ID for the internal Container Apps environment.')
param infrastructureSubnetId string

@description('Existing Key Vault name containing CAO connection secrets.')
param keyVaultName string

@description('Existing Key Vault URI containing CAO connection secrets.')
param keyVaultUri string

@description('Storage account name that holds the ingestion file share.')
param storageAccountName string

@description('Storage account key used only by the Container Apps environment mount.')
@secure()
param storageAccountKey string

@description('Azure Files share containing the verified dashboard artifact.')
param fileShareName string

@description('Immutable CAO server image used for ingestion.')
param ingestionImage string

@description('Redis namespace shared with the Function App.')
param redisNamespace string

@description('Application Insights connection string for ingestion telemetry.')
@secure()
param applicationInsightsConnectionString string

@description('Optional Log Analytics workspace resource ID receiving job logs.')
param logAnalyticsWorkspaceResourceId string = ''

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-ingest-identity'
  location: location
  tags: tags
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-ingest'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: empty(logAnalyticsWorkspaceResourceId) ? {} : {
      destination: 'azure-monitor'
    }
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: true
    }
    zoneRedundant: false
  }
}

resource environmentDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (!empty(logAnalyticsWorkspaceResourceId)) {
  name: 'ingestion-logs'
  scope: environment
  properties: {
    workspaceId: logAnalyticsWorkspaceResourceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
  }
}

resource artifactStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: 'dashboard-artifact'
  properties: {
    azureFile: {
      accountName: storageAccountName
      shareName: fileShareName
      accessMode: 'ReadOnly'
      accountKey: storageAccountKey
    }
  }
}

resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: '${namePrefix}-ingest'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 7200
      replicaRetryLimit: 1
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      secrets: [
        {
          name: 'cao-postgres-url'
          keyVaultUrl: '${keyVaultUri}secrets/cao-postgres-url'
          identity: identity.id
        }
        {
          name: 'cao-redis-url'
          keyVaultUrl: '${keyVaultUri}secrets/cao-redis-url'
          identity: identity.id
        }
        {
          name: 'application-insights-connection-string'
          value: applicationInsightsConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ingest'
          image: ingestionImage
          command: ['/app/cao-dashboard']
          args: [
            'ingest'
            '--source'
            '/ingest'
            '--database-queries'
            '/app/queries/database.json'
          ]
          env: [
            {
              name: 'CAO_POSTGRES_URL'
              secretRef: 'cao-postgres-url'
            }
            {
              name: 'CAO_REDIS_URL'
              secretRef: 'cao-redis-url'
            }
            {
              name: 'CAO_REDIS_NAMESPACE'
              value: redisNamespace
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'application-insights-connection-string'
            }
            {
              name: 'OTEL_SERVICE_NAME'
              value: '${namePrefix}-ingest'
            }
            {
              name: 'DEBUG'
              value: 'cao:ingest'
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          volumeMounts: [
            {
              volumeName: 'artifact'
              mountPath: '/ingest'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'artifact'
          storageType: 'AzureFile'
          storageName: artifactStorage.name
        }
      ]
    }
  }
  dependsOn: [
    secretsUser
  ]
}

output environmentName string = environment.name
output jobName string = job.name
