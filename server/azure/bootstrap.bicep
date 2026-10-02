targetScope = 'resourceGroup'

@description('Azure region for the deployment bootstrap resources.')
param location string = resourceGroup().location

@description('Key Vault name used by the CAO Azure deployment.')
param keyVaultName string

@description('Microsoft Entra object ID that may create and rotate deployment secrets.')
param deployerObjectId string

@description('Enable Key Vault purge protection. Keep enabled outside disposable test environments.')
param enablePurgeProtection bool = true

var tags = {
  workload: 'gh-aw-cao-dashboard'
  deploymentStage: 'bootstrap'
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
    enabledForTemplateDeployment: true
    enableSoftDelete: true
    enablePurgeProtection: enablePurgeProtection
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource deployerSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerObjectId, 'Key Vault Secrets Officer')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
    )
    principalId: deployerObjectId
    principalType: 'User'
  }
}

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
