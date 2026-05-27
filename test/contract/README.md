# Contract Testing for fg-gas-backend

## Architecture Overview

### Message Flow (Correct):

```
farming-grants-agreements-api (Agreement Service)
    │
    │ Produces agreement events
    │ (via SNS/SQS)
    ▼
fg-gas-backend (GAS)
    │
    │ Consumes & processes agreement events
    │ Forwards to CW
    ▼
Case Working Service
```

**Key Point**: GAS is a **CONSUMER** of agreement events, not a producer.

## Contract Test Files

### 1. Consumer Tests (What GAS Expects to Receive)

**File**: `consumer.agreements-api.test.js`

**Purpose**: Define what message structure GAS expects to receive from farming-grants-agreements-api

**Role**:

- **Consumer**: fg-gas-backend (GAS)
- **Provider**: farming-grants-agreements-api (Agreement Service)

**What it does**:

- Defines the contract for messages GAS can handle
- Generates a pact file in `tmp/pacts/`
- This pact gets published to the broker
- Agreement Service team uses this to verify they send correct messages

**Messages Defined**:

1. **Agreement Accepted** - Event type: `cloud.defra.(test|local|prod).(farming-grants-agreements-api|fg-gas-backend).agreement.accepted`
   - Required fields: `id`, `source`, `specVersion`, `datacontenttype`, `time`, `type`
   - Data: `status: "accepted"`, `clientRef`, `code`, `agreementNumber`, `date`

2. **Agreement Withdrawn** - Event type: `cloud.defra.(test|local|prod).(farming-grants-agreements-api|fg-gas-backend).agreement.(withdrawn|withdraw)`
   - Required fields: `id`, `source`, `specVersion`, `datacontenttype`, `time`, `type`
   - Data: `status: "withdrawn"`, `clientRef`, `code`, `agreementNumber`

**⚠️ Critical Assumption**: `data.status` values are lowercase `"accepted"` or `"withdrawn"`. If agreements-api sends workflow codes (e.g., `"PRE_AWARD:APPLICATION:WITHDRAWAL_REQUESTED"`), provider verification will fail and transformation logic will be needed.

### 2. Provider Tests (HTTP API)

**File**: `provider.verification.test.js`

**Purpose**: Verify GAS HTTP API meets grants-ui expectations

**Role**:

- **Provider**: fg-gas-backend (GAS HTTP API)
- **Consumer**: grants-ui (Frontend)

**What it does**:

- Downloads contracts from grants-ui
- Verifies GAS API endpoints match expected responses
- Tests actual HTTP server with mocked dependencies

## Running Tests

### Run Consumer Tests (Generate Pacts)

```bash
# Agreement events consumer
npm run test:contract -- test/contract/consumer.agreements-api.test.js

# CaseStatusUpdatedEvent consumer
npm run test:contract -- test/contract/consumer.cw-backend.test.js
```

### Run Provider Tests

Message provider tests fetch pacts directly from the broker:

```bash
# Verifies GAS sends correct messages to CW (CreateNewCaseCommand, UpdateCaseStatusCommand)
PACT_BROKER_BASE_URL=https://ffc-pact-broker.azure.defra.cloud \
PACT_USER=<user> \
PACT_PASS=<pass> \
npx vitest --config test/contract/vitest.config.js test/contract/provider.cw-backend.test.js

# Verifies GAS sends correct messages to Agreement Service
PACT_BROKER_BASE_URL=https://ffc-pact-broker.azure.defra.cloud \
PACT_USER=<user> \
PACT_PASS=<pass> \
npx vitest --config test/contract/vitest.config.js test/contract/provider.agreements-api.test.js
```

Output will show `pact verifier mode=broker` when running against the broker correctly.

### Run HTTP Provider Tests (grants-ui)

```bash
npm run test:contract -- test/contract/provider.verification.test.js
```

### Publish Consumer Contracts to Broker

```bash
pact broker publish --merge tmp/pacts/*.json \
  --consumer-app-version=$(git describe --tags --abbrev=0 --always) \
  --broker-base-url=https://ffc-pact-broker.azure.defra.cloud \
  --broker-username=$PACT_USER \
  --broker-password=$PACT_PASS
```

**Environment Variables**:

- `PACT_USE_LOCAL=true` - Use local pact files instead of broker (for local debugging only)
- `PACT_LOCAL_DIR` - Custom directory for local pacts (default: `tmp/pacts`)
- `PACT_BROKER_BASE_URL` - Pact broker URL
- `PACT_USER` - Broker username
- `PACT_PASS` - Broker password
- `PACT_PUBLISH_VERIFICATION` - Publish verification results to broker (default: `false`)
- `GITHUB_REF_NAME` - Branch name sent to broker as `providerVersionBranch` (set automatically in CI)

**Files**:

- `provider.cw-backend.test.js` - Verifies GAS sends correct messages to CW
- `provider.agreements-api.test.js` - Verifies GAS sends correct messages to Agreement Service
- `provider.verification.test.js` - Verifies GAS HTTP API for grants-ui
- `verifierConfig.js` - Configuration for HTTP provider verification
- `messageVerifierConfig.js` - Configuration for message provider verification

## Historical Issue: Reversed Roles

**Previous Problem**:
The original contract had consumer/provider roles reversed:

- ❌ Consumer: farming-grants-agreements-api
- ❌ Provider: fg-gas-backend
- ❌ Implied: GAS produces agreement events (WRONG)

**Resolution**:
Corrected to reflect actual architecture:

- ✅ Consumer: fg-gas-backend (receives events)
- ✅ Provider: farming-grants-agreements-api (sends events)
- ✅ GAS processes incoming agreement events and forwards to CW

**Note**: The participant name is simply `fg-gas-backend`, not `fg-gas-backend-sns`. The SNS/SQS transport is an implementation detail, not part of the contract identity.

## Pact Broker

**URL**: https://ffc-pact-broker.azure.defra.cloud

**Expected Contracts**:

1. **fg-gas-backend → farming-grants-agreements-api** (SNS Messages)
   - Consumer: fg-gas-backend
   - Provider: farming-grants-agreements-api
   - Type: Message contract
   - Test: `consumer.agreements-api.test.js`

2. **fg-gas-backend → fg-cw-backend** (SNS Messages)
   - Consumer: fg-gas-backend
   - Provider: fg-cw-backend
   - Type: Message contract
   - Test: `consumer.cw-backend.test.js`
   - Messages: CaseStatusUpdatedEvent (FRPS + WMG)

3. **grants-ui → fg-gas-backend** (HTTP API)
   - Consumer: grants-ui
   - Provider: fg-gas-backend
   - Type: HTTP contract
   - Test: `provider.verification.test.js`

## CI/CD Workflow

### GitHub Actions Workflows

| File                       | Trigger                           | What it does                                                                                      |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `check-pull-request.yml`   | PR to main/dev                    | Runs provider verification (`publish-verification: false`)                                        |
| `publish.yml`              | Push to main                      | Publishes consumer pacts + runs provider verification (`publish-verification: true`)              |
| `pact-verify.yml`          | Called by above two               | Reusable: runs `provider.cw-backend.test.js` and `provider.agreements-api.test.js` against broker |
| `pact-webhook.yml`         | Broker webhook (`pact_published`) | Triggered automatically when fg-cw-backend or farming-grants-agreements-api publishes a pact      |
| `create-pact-webhooks.yml` | Manual (`workflow_dispatch`)      | One-time: registers webhooks on pact broker for both consumers                                    |

### Webhook Setup (one-time after deploy)

Run `create-pact-webhooks.yml` manually via GitHub Actions → **Run workflow**. This registers webhooks for both `fg-cw-backend` and `farming-grants-agreements-api` consumers. After that, any pact published by either consumer automatically triggers this repo's provider verification.

### For GAS Team (Consumer of Agreement Events):

1. Define what messages GAS can handle (`consumer.agreements-api.test.js`)
2. Run consumer tests to generate pact
3. Publish pact to broker — this automatically triggers Agreement Service provider verification via webhook
4. Agreement Service team verifies they meet this contract

### For Agreement Service Team (Provider of Events):

1. GAS consumer pact published → broker fires webhook → `pact-webhook.yml` runs automatically
2. Provider verification results published back to broker
3. No manual action needed

### For Case Working Integration (GAS ↔ CW):

**GAS as Consumer (receives from CW):**

1. Define what messages GAS expects from CW (`consumer.cw-backend.test.js`)
2. Run consumer tests to generate pact
3. Publish pact to broker — this automatically triggers CW provider verification via webhook on the CW repo

**Key Message: CaseStatusUpdatedEvent**

- **Purpose**: CW notifies GAS when case status changes
- **Critical Fields**:
  - `source`: Must be "fg-cw-backend", "CaseWorking", or "CW" (for routing)
  - `data.currentStatus`: Format "PHASE:STAGE:STATUS" (e.g., "PRE_AWARD:ASSESSMENT:WITHDRAWAL_REQUESTED")
  - `data.caseRef`: Maps to application.clientRef in GAS
  - `data.workflowCode`: For validation

**Status Format by Grant**:

| Grant                      | Example Status                                                 | Format                               |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| FRPS (`frps-private-beta`) | `PRE_AWARD:ASSESSMENT:IN_REVIEW`                               | No prefix                            |
| WMG (`woodland`)           | `PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_IN_REVIEW` | `PHASE_`/`STAGE_`/`STATUS_` prefixed |

Both formats match the regex `^[A-Z_]+:[A-Z_]+:[A-Z_]+$` used in contract assertions.

## Related Documentation

- Pact Documentation: https://docs.pact.io/
- Message Pacts: https://docs.pact.io/getting_started/how_pact_works#messages
- Pact Broker: https://github.com/pact-foundation/pact_broker

## WMG (Woodland Management Grant) Contract Notes

**Ticket**: FGP-1011

WMG (`workflowCode: "woodland"`) was added to the consumer test in `consumer.cw-backend.test.js`. Key differences from FRPS:

### WMG Status Format

WMG statuses use `PHASE_`/`STAGE_`/`STATUS_` prefixes unlike FRPS which has bare names:

| Phase             | Stage                         | Status                           |
| ----------------- | ----------------------------- | -------------------------------- |
| `PHASE_PRE_AWARD` | `STAGE_REVIEWING_APPLICATION` | `STATUS_APPLICATION_RECEIVED`    |
| `PHASE_PRE_AWARD` | `STAGE_REVIEWING_APPLICATION` | `STATUS_IN_REVIEW`               |
| `PHASE_PRE_AWARD` | `STAGE_AWAITING_FC`           | `STATUS_AWAITING_FC_REVIEW`      |
| `PHASE_PRE_AWARD` | `STAGE_AWAITING_FC`           | `STATUS_AGREEMENT_GENERATING`    |
| `PHASE_PRE_AWARD` | `STAGE_AWAITING_FC`           | `STATUS_REJECTED_BY_FC`          |
| `PHASE_PRE_AWARD` | `STAGE_AGREEMENT_GENERATED`   | `STATUS_AGREEMENT_GENERATED`     |
| `PHASE_PRE_AWARD` | `STAGE_SENDING_AGREEMENT`     | `STATUS_AWAITING_SEND_AGREEMENT` |
| `PHASE_PRE_AWARD` | `STAGE_SENDING_AGREEMENT`     | `STATUS_AGREEMENT_WITH_CUSTOMER` |
| `PHASE_PRE_AWARD` | `STAGE_REJECTED_BY_APPLICANT` | `STATUS_REJECTED_BY_APPLICANT`   |

### WMG Answers Shape

WMG answers are **flat form fields** (no scheme/applicant/application/payments wrapper like FRPS):

```json
{
  "businessDetailsUpToDate": true,
  "guidanceRead": true,
  "landRegisteredWithRpa": true,
  "landManagementControl": true,
  "publicBodyTenant": false,
  "landHasGrazingRights": false,
  "appLandHasExistingWmp": true,
  "existingWmps": ["WMP-2024-001"],
  "intendToApplyHigherTier": false,
  "includedAllEligibleWoodland": true,
  "totalHectaresForSelectedParcels": 15.0,
  "hectaresTenOrOverYearsOld": 8.5,
  "hectaresUnderTenYearsOld": 4.2,
  "centreGridReference": "SK512347",
  "fcTeamCode": "YORKSHIRE_AND_NORTH_EAST",
  "applicationConfirmation": true
}
```

`existingWmps` is only present when `appLandHasExistingWmp: true`. Field names are authoritative from `woodland.json` schema in `fg-gas-backend`.

### WMG Agreements Supplementary Data

WMG does **not** yet use agreements supplementary data (agreement journey not implemented). The `UpdateCaseStatusCommand` for WMG only carries minimal `supplementaryData` (phase and stage only, no `targetNode`/`dataType`/`data`).

---

**Last Updated**: 2026-05-26
**Tickets**: FGP-789, FGP-1011, FGP-1117
