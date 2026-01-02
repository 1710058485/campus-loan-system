#!/bin/bash

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting permission fix for Azure Container Apps...${NC}"

RG_NAME="campus-loan-system-rg"
ACR_NAME="campusacrc5h6xmuuw7nq6"
ACR_SERVER="${ACR_NAME}.azurecr.io"

echo "Enabling Admin User for ACR: $ACR_NAME..."
az acr update -n $ACR_NAME --admin-enabled true

echo "Fetching ACR credentials..."
USERNAME=$(az acr credential show -n $ACR_NAME --query username -o tsv)
PASSWORD=$(az acr credential show -n $ACR_NAME --query "passwords[0].value" -o tsv)

if [ -z "$PASSWORD" ]; then
    echo -e "${RED}Failed to get ACR password!${NC}"
    exit 1
fi

echo "Got credentials for user: $USERNAME"

APPS=("web-app" "inventory-service" "loan-service" "notification-service")

for APP in "${APPS[@]}"; do
    echo "Updating registry credentials for $APP..."
    az containerapp registry set \
        --name $APP \
        --resource-group $RG_NAME \
        --server $ACR_SERVER \
        --username $USERNAME \
        --password "$PASSWORD"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Successfully updated $APP${NC}"
    else
        echo -e "${RED}❌ Failed to update $APP${NC}"
    fi
done

echo -e "${GREEN}All permissions fixed! Please refresh your Web App.${NC}"
