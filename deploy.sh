#!/bin/bash
set -e

# Configuration
RG_NAME="campus-loan-system-rg"
ACR_NAME="campusacrc5h6xmuuw7nq6"
ACR_LOGIN_SERVER="campusacrc5h6xmuuw7nq6.azurecr.io"

# Get URLs dynamically
echo "Fetching Service URLs..."
INVENTORY_FQDN=$(az containerapp show --name inventory-service --resource-group $RG_NAME --query properties.configuration.ingress.fqdn -o tsv)
LOAN_FQDN=$(az containerapp show --name loan-service --resource-group $RG_NAME --query properties.configuration.ingress.fqdn -o tsv)

INVENTORY_URL="https://$INVENTORY_FQDN"
LOAN_URL="https://$LOAN_FQDN"

echo "Inventory URL: $INVENTORY_URL"
echo "Loan URL:      $LOAN_URL"

# Login to ACR
echo "Logging into ACR..."
az acr login --name $ACR_NAME

# Function to build and deploy
deploy_service() {
  SERVICE_NAME=$1
  DIR_NAME=$2
  
  echo "--------------------------------------------------"
  echo "Deploying $SERVICE_NAME..."
  
  IMAGE_TAG="$ACR_LOGIN_SERVER/$SERVICE_NAME:latest"
  
  # Build
  if [ "$SERVICE_NAME" == "web-app" ]; then
    echo "Building web-app with API URLs..."
    docker build --platform linux/amd64 -t $IMAGE_TAG \
      --build-arg VITE_INVENTORY_API_URL=$INVENTORY_URL \
      --build-arg VITE_LOAN_API_URL=$LOAN_URL \
      ./$DIR_NAME
  else
    docker build --platform linux/amd64 -t $IMAGE_TAG ./$DIR_NAME
  fi
  
  # Push
  echo "Pushing image..."
  docker push $IMAGE_TAG
  
  # Update Container App
  echo "Updating Container App..."
  az containerapp update \
    --name $SERVICE_NAME \
    --resource-group $RG_NAME \
    --image $IMAGE_TAG \
    --output none
    
  echo "✅ $SERVICE_NAME Done!"
}

# Deploy all services
deploy_service "inventory-service" "inventory-service"
deploy_service "loan-service" "loan-service"
deploy_service "notification-service" "notification-service"
deploy_service "web-app" "web-app"

echo "--------------------------------------------------"
echo "🎉 All services deployed successfully!"
echo "Web App URL: https://$(az containerapp show --name web-app --resource-group $RG_NAME --query properties.configuration.ingress.fqdn -o tsv)"
