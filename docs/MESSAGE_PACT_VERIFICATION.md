# Message Pact Verification with Pact Broker

This document explains how message contract verification works between fg-gas-backend and fg-cw-backend, and why the implementation differs from HTTP contract verification.

## The Problem

Message pacts (async messaging contracts) require a different verification approach than HTTP pacts because:

1. **MessageProviderPact has no broker integration** - Unlike HTTP Verifier, MessageProviderPact.verify() doesn't have built-in support for fetching pacts from or publishing results to a Pact Broker
2. **No CLI commands for message verification** - The pact-broker CLI doesn't have commands like `download-pacts` or `publish-verification-results`
3. **Manual workflow required** - We must manually download pacts, verify them locally, and publish results via REST API

## The Solution

We use a 3-step approach with the Pact Broker REST API:

### Step 1: Download Pacts from Broker

Use curl to fetch the latest pact via the Pact Broker HTTP API:

```bash
curl -u "${PACT_USER}:${PACT_PASS}" \
  "${PACT_BROKER_BASE_URL}/pacts/provider/fg-gas-backend/consumer/fg-cw-backend/latest" \
  -o tmp/pacts/fg-cw-backend-fg-gas-backend.json
```

### Step 2: Run Message Provider Verification Locally

Run MessageProviderPact in local mode with the downloaded pact:

```bash
PACT_USE_LOCAL="true" PACT_LOCAL_DIR="tmp/pacts" \
  npx vitest test/contract/provider.cw-backend.test.js
```

The test uses `messageVerifierConfig.js` which checks the `PACT_USE_LOCAL` environment variable and reads from the local directory instead of fetching from broker.

### Step 3: Publish Verification Results via REST API

Extract the `pb:publish-verification-results` HAL link from the pact file and POST results:

```bash
# Get the verification URL from pact HAL links
VERIFICATION_URL=$(jq -r '._links."pb:publish-verification-results".href' "$pact_file")

# Create verification result JSON
VERIFICATION_RESULT='{
  "success": true,
  "providerApplicationVersion": "<git-tag>",
  "testResults": [{
    "testDescription": "Message provider verification",
    "success": true
  }]
}'

# POST to broker
curl -X POST \
  -u "${PACT_USER}:${PACT_PASS}" \
  -H "Content-Type: application/json" \
  -d "${VERIFICATION_RESULT}" \
  "$VERIFICATION_URL"
```

## Implementation Details

### messageVerifierConfig.js

Helper function that builds verification options for MessageProviderPact:

```javascript
export const buildMessageVerifierOptions = ({ providerName, consumerName }) => {
  const useLocal = env.PACT_USE_LOCAL === "true";

  const baseOpts = {
    provider: providerName,
    providerVersion: getLatestGitTagOrFallback(),
  };

  if (useLocal) {
    const pactDir =
      env.PACT_LOCAL_DIR || path.resolve(process.cwd(), "tmp/pacts");
    const pactUrls = globSync(`${pactDir}/*.json`, { nodir: true });
    return {
      ...baseOpts,
      pactUrls,
      publishVerificationResult: false, // No broker when local
    };
  }

  // Broker mode (not used in CI, but available for local testing)
  return {
    ...baseOpts,
    pactBrokerUrl: env.PACT_BROKER_BASE_URL,
    consumerVersionSelectors: [{ consumer: consumerName, latest: true }],
    pactBrokerUsername: env.PACT_USER,
    pactBrokerPassword: env.PACT_PASS,
    publishVerificationResult: env.PACT_PUBLISH_VERIFICATION === "true",
  };
};
```

**Important:** Even though broker mode is configured, MessageProviderPact doesn't actually fetch from or publish to the broker. This is why we need the manual 3-step approach.

### Provider Test File

Example: `test/contract/provider.cw-backend.test.js`

```javascript
import { MessageProviderPact } from "@pact-foundation/pact";
import { buildMessageVerifierOptions } from "./messageVerifierConfig.js";

describe("Message Provider Verification", () => {
  it("should verify GAS sends messages matching CW expectations", async () => {
    const messagePact = new MessageProviderPact({
      messageProviders: {
        // Message handler implementations
        "ApplicationSubmittedEvent Provider": () => {
          return buildApplicationSubmittedEvent();
        },
      },
    });

    const verifyOpts = buildMessageVerifierOptions({
      providerName: "fg-gas-backend",
      consumerName: "fg-cw-backend",
    });

    return messagePact.verify(verifyOpts);
  });
});
```

### GitHub Workflow (publish.yml)

The complete workflow for message provider verification:

```yaml
- name: Setup Pact CLI for message verification
  run: |
    curl -fsSL https://raw.githubusercontent.com/pact-foundation/pact-standalone/master/install.sh | PACT_CLI_VERSION=v2.5.9 bash
    echo "PATH=${PATH}:${PWD}/pact/bin/" >> $GITHUB_ENV

- name: Download message pacts from broker
  env:
    PACT_BROKER_BASE_URL: https://ffc-pact-broker.azure.defra.cloud
  run: |
    mkdir -p tmp/pacts
    curl -u "${PACT_USER}:${PACT_PASS}" \
      "${PACT_BROKER_BASE_URL}/pacts/provider/fg-gas-backend/consumer/fg-cw-backend/latest" \
      -o tmp/pacts/fg-cw-backend-fg-gas-backend.json

- name: Run message provider tests (local mode)
  env:
    PACT_USE_LOCAL: "true"
    PACT_LOCAL_DIR: "tmp/pacts"
  run: |
    npx vitest --config test/contract/vitest.config.js test/contract/provider.cw-backend.test.js

- name: Publish message provider verification results to broker
  env:
    PACT_BROKER_BASE_URL: https://ffc-pact-broker.azure.defra.cloud
  run: |
    PROVIDER_VERSION=$(git describe --tags --abbrev=0 --always)
    for pact_file in tmp/pacts/fg-cw-backend-fg-gas-backend*.json; do
      if [ -f "$pact_file" ]; then
        echo "Publishing verification results for $pact_file"

        VERIFICATION_URL=$(jq -r '._links."pb:publish-verification-results".href' "$pact_file")

        if [ "$VERIFICATION_URL" == "null" ] || [ -z "$VERIFICATION_URL" ]; then
          echo "Warning: No pb:publish-verification-results link found in pact file"
          continue
        fi

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

        echo "Posting to: $VERIFICATION_URL"
        curl -X POST \
          -u "${PACT_USER}:${PACT_PASS}" \
          -H "Content-Type: application/json" \
          -d "${VERIFICATION_RESULT}" \
          "$VERIFICATION_URL"
      fi
    done

- name: Publish consumer pacts
  env:
    PACT_BROKER_BASE_URL: https://ffc-pact-broker.azure.defra.cloud
  run: |
    pact broker publish --merge \
      --broker-base-url "${PACT_BROKER_BASE_URL}" \
      --broker-username "${PACT_USER}" \
      --broker-password "${PACT_PASS}" \
      --consumer-app-version "$(git describe --tags --abbrev=0 --always)" \
      tmp/pacts/*.json
```

## Testing Locally

Use the provided test script:

```bash
export PACT_USER="your-username"
export PACT_PASS="your-password"
./test-publish-verification.sh
```

The script will:

1. Download the latest pact from the broker
2. Run message provider verification tests
3. Publish verification results to the broker
4. Show HTTP response status

Expected output:

- HTTP Status: 200 or 201
- "Last verified" timestamp updates in Pact Broker UI

## Comparison: HTTP vs Message Verification

### HTTP Provider Verification (e.g., grants-ui → fg-gas-backend)

**Simple approach** - HTTP Verifier has built-in broker integration:

```javascript
// verifierConfig.js
return {
  provider: providerName,
  providerBaseUrl: "http://localhost:3000",
  pactBrokerUrl: env.PACT_BROKER_BASE_URL,
  consumerVersionSelectors: [{ consumer: "grants-ui", latest: true }],
  pactBrokerUsername: env.PACT_USER,
  pactBrokerPassword: env.PACT_PASS,
  publishVerificationResult: true, // ✅ This works!
};
```

HTTP Verifier automatically:

- Fetches pacts from broker
- Runs verification
- Publishes results back

**Workflow:**

```yaml
- name: Run contract tests (consumer + HTTP provider)
  env:
    PACT_BROKER_BASE_URL: https://ffc-pact-broker.azure.defra.cloud
    PACT_PUBLISH_VERIFICATION: true
  run: |
    npm run test:contract -- test/contract/provider.verification.test.js
```

### Message Provider Verification (e.g., fg-cw-backend → fg-gas-backend)

**Complex approach** - MessageProviderPact has NO broker integration:

```javascript
// messageVerifierConfig.js
return {
  provider: providerName,
  pactUrls: ["tmp/pacts/consumer-provider.json"], // ⚠️ Must be local files
  publishVerificationResult: false, // ⚠️ Doesn't work even if true
};
```

MessageProviderPact:

- ❌ Cannot fetch pacts from broker
- ❌ Cannot publish results to broker
- ✅ Can only verify local pact files

**Workflow:**
Requires manual 3-step process (download → verify → publish) as documented above.

## Why This Difference?

The Pact JavaScript implementation uses two different libraries:

1. **@pact-foundation/pact-core** (Rust-based) - Used by HTTP Verifier
   - Full broker integration via native Rust `pact_verifier`
   - Supports fetching and publishing

2. **@pact-foundation/pact** (JavaScript-based) - MessageProviderPact
   - Pure JavaScript implementation
   - No broker integration
   - Local file verification only

## Key Limitations

1. **No automatic broker fetch** - Must manually download pacts with curl
2. **No automatic result publishing** - Must POST results via REST API
3. **Local mode required** - MessageProviderPact.verify() only works with local files
4. **CLI gaps** - pact-broker CLI doesn't have message-specific commands
5. **Manual workflow in CI** - Cannot use simple one-liner like HTTP verification

## References

- [Pact Broker REST API - Publishing Verification Results](https://docs.pact.io/pact_broker/advanced_topics/api_docs/publish_verification_result)
- [Provider Verification Results](https://docs.pact.io/pact_broker/advanced_topics/provider_verification_results)
- [Pact JavaScript MessageProviderPact](https://github.com/pact-foundation/pact-js/blob/master/src/messageProviderPact.ts)

## Troubleshooting

### "No pb:publish-verification-results link found"

The downloaded pact file doesn't contain HAL links. Check:

- Is the pact actually in the broker?
- Is the curl download successful?
- Try: `jq '._links' tmp/pacts/*.json` to see available links

### "HTTP Status: 401 Unauthorized"

Authentication failed. Verify:

- PACT_USER and PACT_PASS are set correctly
- Credentials have permission to publish results

### "HTTP Status: 404 Not Found"

The verification URL is invalid. Check:

- The pact exists in the broker
- The URL extracted from HAL links is correct

### "Last verified" still not updating

Possible causes:

- Verification failed (check test output)
- POST request failed (check HTTP status)
- Wrong provider version (check git tags)
- Broker cache delay (wait 1-2 minutes)
