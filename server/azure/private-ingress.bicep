targetScope = 'resourceGroup'

@description('Region of the approved existing endpoint subnet, which may differ from the app region.')
param location string

@minLength(1)
@description('Existing Function App resource ID, possibly in a different subscription. This module does not modify the app. Deploy this module in the endpoint subnet subscription.')
param functionAppResourceId string

@description('Name of the new private endpoint.')
param privateEndpointName string

@minLength(1)
@description('Approved existing nondelegated subnet resource ID with sanctioned client routing and endpoint security controls. Do not use the app integration subnet.')
param subnetResourceId string

@minLength(1)
@description('Existing approved privatelink.azurewebsites.net zone resource ID. Its VNet links and corporate DNS forwarding must already be established.')
param privateDnsZoneResourceId string

resource endpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: privateEndpointName
  location: location
  properties: {
    subnet: {
      id: subnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: '${privateEndpointName}-sites'
        properties: {
          privateLinkServiceId: functionAppResourceId
          groupIds: ['sites']
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: endpoint
  name: 'app-service'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'app-service'
        properties: {
          privateDnsZoneId: privateDnsZoneResourceId
        }
      }
    ]
  }
}

output privateEndpointId string = endpoint.id
