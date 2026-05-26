#!/bin/bash
# Deploy to Google Cloud Run
# Usage: ./deploy.sh <gcp-project-id> <region> <google-client-id> <google-client-secret>

set -e

PROJECT_ID=${1:?"Usage: ./deploy.sh <project-id> <region> <google-client-id> <google-client-secret>"}
REGION=${2:-"me-west1"}
GOOGLE_CLIENT_ID=${3:?"Google OAuth Client ID required"}
GOOGLE_CLIENT_SECRET=${4:?"Google OAuth Client Secret required"}
SERVICE_NAME="gas-mcp-server"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "==> Building image..."
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT_ID}"

echo "==> Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}" \
  --project "${PROJECT_ID}"

# Get the deployed URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)")

# Update SERVER_URL env var to match the actual URL
echo "==> Setting SERVER_URL..."
gcloud run services update "${SERVICE_NAME}" \
  --region "${REGION}" \
  --update-env-vars "SERVER_URL=${SERVICE_URL}" \
  --project "${PROJECT_ID}"

echo ""
echo "========================================="
echo "  Deployed successfully!"
echo "========================================="
echo ""
echo "MCP Server URL:  ${SERVICE_URL}/mcp"
echo "Health check:    ${SERVICE_URL}/health"
echo "OAuth metadata:  ${SERVICE_URL}/.well-known/oauth-protected-resource"
echo ""
echo "Next steps:"
echo "  1. Add this redirect URI to your Google OAuth client:"
echo "     ${SERVICE_URL}/oauth/callback"
echo ""
echo "  2. Also add Claude's callback URI:"
echo "     https://claude.ai/api/mcp/auth_callback"
echo ""
echo "  3. Test in Claude: Settings > Connectors > Add custom connector"
echo "     Enter: ${SERVICE_URL}/mcp"
echo ""
