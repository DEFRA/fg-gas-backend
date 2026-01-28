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

1. Agreement Created - `agreement.create` event
2. Agreement Withdrawn - `agreement.withdraw` event

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
npm run test:contract -- test/contract/consumer.agreements-api.test.js
```

This generates: `tmp/pacts/fg-gas-backend-farming-grants-agreements-api.json`

### Publish Consumer Contracts to Broker

```bash
# Publish the pact so Agreement Service team can verify against it
npx pact-broker publish tmp/pacts \
  --consumer-app-version=$(git rev-parse HEAD) \
  --broker-base-url=https://ffc-pact-broker.azure.defra.cloud \
  --broker-username=$PACT_USER \
  --broker-password=$PACT_PASS
```

### Run Provider Tests (Verify HTTP API)

```bash
npm run test:contract -- test/contract/provider.verification.test.js
```

### Run All Contract Tests

```bash
npm run test:contract
```

### Publish Verification Results

```bash
PACT_PUBLISH_VERIFICATION=true npm run test:contract
```

## Historical Issue: Reversed Roles

**Previous Problem**:
The original contract had consumer/provider roles reversed:

- ❌ Consumer: farming-grants-agreements-api
- ❌ Provider: fg-gas-backend-sns
- ❌ Implied: GAS produces agreement events (WRONG)

**Resolution**:
Corrected to reflect actual architecture:

- ✅ Consumer: fg-gas-backend (receives events)
- ✅ Provider: farming-grants-agreements-api (sends events)
- ✅ GAS processes incoming agreement events and forwards to CW

## Pact Broker

**URL**: https://ffc-pact-broker.azure.defra.cloud

**Expected Contracts**:

1. **fg-gas-backend → farming-grants-agreements-api** (SNS Messages)
   - Consumer: fg-gas-backend
   - Provider: farming-grants-agreements-api
   - Type: Message contract

2. **grants-ui → fg-gas-backend** (HTTP API)
   - Consumer: grants-ui
   - Provider: fg-gas-backend
   - Type: HTTP contract

## Workflow

### For GAS Team (Consumer of Agreement Events):

1. Define what messages GAS can handle (`consumer.agreements-api.test.js`)
2. Run consumer tests to generate pact
3. Publish pact to broker
4. Agreement Service team verifies they meet this contract

### For Agreement Service Team (Provider of Events):

1. Download GAS consumer contract from broker
2. Write provider verification tests
3. Verify their message producer meets GAS expectations
4. Publish verification results

## Related Documentation

- Pact Documentation: https://docs.pact.io/
- Message Pacts: https://docs.pact.io/getting_started/how_pact_works#messages
- Pact Broker: https://github.com/pact-foundation/pact_broker

---

**Last Updated**: 2026-01-26
**Ticket**: FGP-789
