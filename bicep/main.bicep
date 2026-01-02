param location string = 'uksouth'
param envName string = 'campus-loan-env'
param acrName string = 'campusacr${uniqueString(resourceGroup().id)}'
param sqlServerName string = 'campus-db-${uniqueString(resourceGroup().id)}'
param sqlAdminLogin string = 'adminuser'
@secure()
param sqlAdminPassword string

// Log Analytics
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'campus-logs-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// Container Apps Environment
resource containerAppEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ACR
resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// PostgreSQL Flexible Server
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2022-12-01' = {
  name: sqlServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    version: '13'
    storage: {
      storageSizeGB: 32
    }
  }
}

resource postgresFw 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = {
  parent: postgres
  name: 'allow-azure'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2022-12-01' = {
  parent: postgres
  name: 'campus_db'
  properties: {
    charset: 'utf8'
    collation: 'en_US.utf8'
  }
}

// RabbitMQ
resource rabbitmq 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'rabbitmq'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: false
        targetPort: 5672
        transport: 'tcp'
      }
    }
    template: {
      containers: [
        {
          name: 'rabbitmq'
          image: 'rabbitmq:3-management'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'RABBITMQ_DEFAULT_USER'
              value: 'user'
            }
            {
              name: 'RABBITMQ_DEFAULT_PASS'
              value: 'password'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// Inventory Service
resource inventoryService 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'inventory-service'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
      }
      secrets: [
        {
          name: 'db-password'
          value: sqlAdminPassword
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'inventory-service'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              value: 'postgres://${sqlAdminLogin}:${sqlAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/campus_db'
            }
            {
              name: 'AUTH0_AUDIENCE'
              value: 'https://campus-loan-api'
            }
            {
              name: 'AUTH0_ISSUER_BASE_URL'
              value: 'https://dev-fnovcg4yh5yl3vxf.us.auth0.com/'
            }
          ]
        }
      ]
    }
  }
}

// Loan Service
resource loanService 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'loan-service'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
      }
    }
    template: {
      containers: [
        {
          name: 'loan-service'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              value: 'postgres://${sqlAdminLogin}:${sqlAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/campus_db'
            }
            {
              name: 'RABBITMQ_URL'
              value: 'amqp://user:password@${rabbitmq.name}:5672'
            }
            {
              name: 'AUTH0_AUDIENCE'
              value: 'https://campus-loan-api'
            }
            {
              name: 'AUTH0_ISSUER_BASE_URL'
              value: 'https://dev-fnovcg4yh5yl3vxf.us.auth0.com/'
            }
          ]
        }
      ]
    }
  }
}

// Notification Service
resource notificationService 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'notification-service'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    template: {
      containers: [
        {
          name: 'notification-service'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'RABBITMQ_URL'
              value: 'amqp://user:password@${rabbitmq.name}:5672'
            }
          ]
        }
      ]
    }
  }
}

// Web App
resource webApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'web-app'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
      }
    }
    template: {
      containers: [
        {
          name: 'web-app'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
        }
      ]
    }
  }
}

// Outputs
output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
