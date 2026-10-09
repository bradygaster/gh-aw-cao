param location string
param namePrefix string
param environmentName string
param containerRegistryName string
param keyVaultName string
param ingestionImage string
@minValue(7)
param postgresRunRetentionDays int = 45

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
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/cao-postgres-url'
          identity: identity.id
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
            '/data'
            '--database-queries'
            '/app/queries/database.json'
            '--redis-namespace'
            'azure-dashboard'
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
