#!/bin/bash
set -e

# Configuration
RG_NAME="campus-loan-system-rg"
LOCATION="uksouth"
DEPLOYMENT_NAME="campus-loan-deployment"

# Generate a random password for DB
DB_PASSWORD=$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 12)
DB_PASSWORD="${DB_PASSWORD}!" # Ensure complexity

echo ">>> Creating Resource Group: $RG_NAME in $LOCATION..."
az group create --name $RG_NAME --location $LOCATION

echo ">>> Deploying Bicep template..."
echo "Using DB Password: $DB_PASSWORD"

az deployment group create \
  --name $DEPLOYMENT_NAME \
  --resource-group $RG_NAME \
  --template-file main.bicep \
  --parameters sqlAdminPassword=$DB_PASSWORD \
  --parameters location=$LOCATION

echo ">>> Deployment Complete!"
echo "Retrieving outputs..."

ACR_LOGIN_SERVER=$(az deployment group show --resource-group $RG_NAME --name $DEPLOYMENT_NAME --query properties.outputs.acrLoginServer.value -o tsv)
ACR_NAME=$(az deployment group show --resource-group $RG_NAME --name $DEPLOYMENT_NAME --query properties.outputs.acrName.value -o tsv)

echo "--------------------------------------------------"
echo "ACR Login Server: $ACR_LOGIN_SERVER"
echo "ACR Name:         $ACR_NAME"
echo "DB Password:      $DB_PASSWORD"
echo "--------------------------------------------------"
echo "Now you can use the ../deploy.sh script to build and push images."
echo "Make sure to update deploy.sh to use these new resource names if they differ!"
