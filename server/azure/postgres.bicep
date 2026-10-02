@description('Azure region for PostgreSQL.')
param location string

@description('Resource tags.')
param tags object

@description('PostgreSQL Flexible Server name.')
param serverName string

@description('PostgreSQL administrator login.')
param administratorLogin string

@secure()
@description('PostgreSQL administrator password read from Key Vault by the parent deployment.')
param administratorLoginPassword string

@description('Delegated subnet resource ID for PostgreSQL Flexible Server.')
param delegatedSubnetResourceId string

@description('Private DNS zone resource ID for PostgreSQL Flexible Server.')
param privateDnsZoneResourceId string

@description('Existing Key Vault name where the PostgreSQL URL is stored.')
param keyVaultName string

@description('PostgreSQL compute SKU.')
param skuName string = 'Standard_B1ms'

@description('PostgreSQL compute tier.')
param skuTier string = 'Burstable'

@minValue(32)
@description('PostgreSQL storage size in GiB.')
param storageSizeGB int = 32

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    version: '16'
    network: {
      delegatedSubnetResourceId: delegatedSubnetResourceId
      privateDnsZoneArmResourceId: privateDnsZoneResourceId
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'cao'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'cao-postgres-url'
  properties: {
    value: 'postgresql://${administratorLogin}:${uriComponent(administratorLoginPassword)}@${server.properties.fullyQualifiedDomainName}:5432/${database.name}?sslmode=require'
    contentType: 'CAO dashboard PostgreSQL connection URL'
  }
}

output hostName string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
