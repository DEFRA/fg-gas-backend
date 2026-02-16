#!/bin/bash

# Test script for publishing message provider verification results locally

set -e

PACT_BROKER_BASE_URL="https://ffc-pact-broker.azure.defra.cloud"

# Check for required environment variables
if [ -z "${PACT_USER}" ] || [ -z "${PACT_PASS}" ]; then
  echo "Error: PACT_USER and PACT_PASS environment variables must be set"
  exit 1
fi

echo "=== Step 1: Download pact from broker ==="
mkdir -p tmp/pacts
curl -u "${PACT_USER}:${PACT_PASS}" \
  "${PACT_BROKER_BASE_URL}/pacts/provider/fg-gas-backend/consumer/fg-cw-backend/latest" \
  -o tmp/pacts/fg-cw-backend-fg-gas-backend.json

echo ""
echo "=== Step 2: Run message provider tests ==="
PACT_USE_LOCAL="true" PACT_LOCAL_DIR="tmp/pacts" \
  npx vitest --config test/contract/vitest.config.js test/contract/provider.cw-backend.test.js

echo ""
echo "=== Step 3: Publish verification results to broker ==="
PROVIDER_VERSION=$(git describe --tags --abbrev=0 --always)
echo "Provider version: $PROVIDER_VERSION"

for pact_file in tmp/pacts/fg-cw-backend-fg-gas-backend*.json; do
  if [ -f "$pact_file" ]; then
    echo "Publishing verification results for $pact_file"

    # Extract the publish verification results URL from the pact links
    VERIFICATION_URL=$(jq -r '._links."pb:publish-verification-results".href' "$pact_file")

    if [ "$VERIFICATION_URL" == "null" ] || [ -z "$VERIFICATION_URL" ]; then
      echo "Warning: No pb:publish-verification-results link found in pact file"
      cat "$pact_file" | jq '._links'
      continue
    fi

    # Create verification result JSON
    VERIFICATION_RESULT=$(cat <<EOF
{
  "success": true,
  "providerApplicationVersion": "${PROVIDER_VERSION}",
  "testResults": [{
    "testDescription": "Message provider verification",
    "success": true
  }]
}
EOF
)

    # Publish to broker via REST API
    echo "Posting to: $VERIFICATION_URL"
    RESPONSE=$(curl -X POST \
      -u "${PACT_USER}:${PACT_PASS}" \
      -H "Content-Type: application/json" \
      -d "${VERIFICATION_RESULT}" \
      -w "\nHTTP Status: %{http_code}\n" \
      "$VERIFICATION_URL")

    echo "Response: $RESPONSE"
  fi
done

echo ""
echo "=== Done! Check the Pact Broker for updated verification status ==="
