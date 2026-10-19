param location string
param namePrefix string
param environmentName string
param containerRegistryName string
param keyVaultName string
param ingestionImage string
@minValue(7)
param postgresRunRetentionDays int = 45
@description('Key Vault secret that stores the PostgreSQL URL.')
param postgresUrlSecretName string = 'cao-postgres-url'
param canonicalNamespace string = 'azure-dashboard'
param operationalNamespace string = 'azure-dashboard-operational'
@minValue(1)
param operationalCacheMaxBytes int = 33554432
@minValue(1)
param operationalCacheMaxValueBytes int = 4194304
@minValue(1)
param operationalCacheMaxEntries int = 1024
@minValue(1)
param operationalProtectedMaxBytes int = 134217728
@minValue(1)
param operationalProtectedMaxEntries int = 200000

var retentionEnvironment = [
  {
    name: 'CAO_POSTGRES_RUN_RETENTION_DAYS'
    value: string(postgresRunRetentionDays)
  }
  {
    name: 'CAO_POSTGRES_LINKED_RETENTION_DAYS'
    value: string(postgresRunRetentionDays)
  }
]
// Bootstrap is the schema owner's idempotent provisioning step. The URL secret
// already carries the administrator credential used by ingestion.
var adminEnvironment = [
  {
    name: 'CAO_DATABASE_ADMIN_URL'
    secretRef: 'cao-postgres-url'
  }
]
var bootstrapResources = {
  cpu: json('0.5')
  memory: '1Gi'
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-ingest-identity'
  location: location
}
module roles 'worker-roles.bicep' = {
  name: 'ingestion-roles'
  params: {
    keyVaultName: keyVault.name
    containerRegistryName: registry.name
    principalId: identity.properties.principalId
  }
}
resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: '${namePrefix}-ingest'
  location: location
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
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        {
          name: 'cao-postgres-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${postgresUrlSecretName}'
          identity: identity.id
        }
      ]
    }
    template: {
      initContainers: [
        {
          name: 'bootstrap-canonical'
          image: ingestionImage
          command: ['/app/cao-dashboard']
          args: [
            'database'
            'bootstrap'
            '--store'
            'canonical'
            '--namespace'
            canonicalNamespace
          ]
          env: concat(adminEnvironment, retentionEnvironment)
          resources: bootstrapResources
        }
        {
          name: 'bootstrap-operational'
          image: ingestionImage
          command: ['/app/cao-dashboard']
          args: [
            'database'
            'bootstrap'
            '--store'
            'operational'
            '--namespace'
            operationalNamespace
          ]
          env: concat(adminEnvironment, [
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
          ])
          resources: bootstrapResources
        }
      ]
      containers: [
        {
          name: 'ingest'
          image: ingestionImage
          command: ['/app/cao-dashboard']
          args: [
            'ingest'
            '--source'
            '/data'
            '--database-queries'
            '/app/queries/database.json'
            '--redis-namespace'
            canonicalNamespace
          ]
          env: [
            {
              name: 'CAO_POSTGRES_URL'
              secretRef: 'cao-postgres-url'
            }
            {
              name: 'CAO_POSTGRES_RUN_RETENTION_DAYS'
              value: string(postgresRunRetentionDays)
            }
            {
              name: 'CAO_POSTGRES_LINKED_RETENTION_DAYS'
              value: string(postgresRunRetentionDays)
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
        }
      ]
    }
  }
  dependsOn: [roles]
}
output jobName string = job.name
