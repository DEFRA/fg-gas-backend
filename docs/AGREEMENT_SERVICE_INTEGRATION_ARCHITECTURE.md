# GAS ↔ Agreement Service Integration Architecture

This document explains the bidirectional message integration between fg-gas-backend (GAS) and farming-grants-agreements-api (Agreement Service), including production code references and corresponding contract tests.

## Overview

GAS and Agreement Service have a **bidirectional** async message integration:

- **GAS → Agreement Service**: GAS sends commands to trigger agreement creation
- **Agreement Service → GAS**: Agreement Service sends events about agreement status changes

## Architecture Diagram

```
┌─────────────────┐                           ┌──────────────────────────┐
│                 │   agreement.create        │                          │
│   fg-gas-       │──────────────────────────>│  farming-grants-         │
│   backend       │                           │  agreements-api          │
│   (GAS)         │                           │  (Agreement Service)     │
│                 │   agreement.accepted      │                          │
│                 │<──────────────────────────│                          │
│                 │   agreement_status_updated│                          │
└─────────────────┘                           └──────────────────────────┘
```

## Integration Details

### 1. GAS → Agreement Service (GAS as Provider)

#### Message: `agreement.create`

**Purpose**: GAS sends this command to Agreement Service to trigger the creation of an agreement offer.

**When**: Triggered when an application is approved in GAS.

**Production Code**:

- **Event Class**: `src/grants/events/create-agreement.command.js`

  ```javascript
  export class CreateAgreementCommand extends CloudEvent {
    constructor(application) {
      super(
        "agreement.create",
        {
          clientRef: application.clientRef,
          code: application.code,
          identifiers: application.identifiers,
          metadata: application.metadata,
          answers: application.getAnswers(),
        },
        `${application.clientRef}-${application.code}`,
      );
    }
  }
  ```

- **Use Cases**:
  1. `src/grants/use-cases/approve-application.use-case.js:44-50`

     ```javascript
     const createAgreementCommand = new CreateAgreementCommand(application);
     const createAgreementPublication = new Outbox({
       event: createAgreementCommand,
       target: config.sns.createAgreementTopicArn,
       segregationRef: Outbox.getSegregationRef(createAgreementCommand),
     });
     ```

  2. `src/grants/use-cases/create-agreement-command.use-case.js:20-27`
     ```javascript
     const createAgreementCommand = new CreateAgreementCommand(application);
     await insertMany(
       [
         new Outbox({
           event: createAgreementCommand,
           target: config.sns.createAgreementTopicArn,
           segregationRef: Outbox.getSegregationRef(createAgreementCommand),
         }),
       ],
       session,
     );
     ```

- **SNS Topic**: `config.sns.createAgreementTopicArn` (env: `GAS__SNS__CREATE_AGREEMENT_TOPIC_ARN`)
- **Target Queue**: Agreement Service's `create_agreement` SQS queue

**CloudEvent Structure**:

```json
{
  "id": "uuid",
  "source": "fg-gas-backend",
  "specversion": "1.0",
  "type": "cloud.defra.{env}.fg-gas-backend.agreement.create",
  "datacontenttype": "application/json",
  "time": "ISO8601 timestamp",
  "data": {
    "clientRef": "string",
    "code": "string",
    "identifiers": {},
    "metadata": {},
    "answers": {}
  }
}
```

**GAS Contract Tests**:

- **Provider Test**: `test/contract/provider.agreements-api.test.js`
  - Verifies GAS sends `agreement.create` message matching Agreement Service expectations
  - Uses `MessageProviderPact` to define the message structure
  - Will be verified against Agreement Service's consumer pact

**Agreement Service Contract Tests**:

- **Consumer Test**: `src/contracts/consumer/gas-agreements.created.contract.test.js`
  - Defines expectations for incoming `agreement.create` messages
  - Handler: `handleCreateAgreementEvent`
  - Action: Calls `createOffer` to create agreement in database

**Status**: ✅ **Both tests exist and match**

---

#### Message: `application.status.updated` (Triggers Withdrawal)

**Purpose**: GAS sends this event when an application status changes. Agreement Service listens to this to trigger agreement withdrawal.

**When**: Triggered when:

1. Application is withdrawn
2. Agreement is withdrawn
3. Application status transitions occur

**Production Code**:

- **Event Class**: `src/grants/events/application-status-updated.event.js`

  ```javascript
  export class ApplicationStatusUpdatedEvent extends CloudEvent {
    constructor(props) {
      super(
        "application.status.updated",
        {
          clientRef: props.clientRef,
          grantCode: props.code,
          previousStatus: props.previousStatus,
          currentStatus: props.currentStatus,
        },
        `${props.clientRef}-${props.code}`,
      );
    }
  }
  ```

- **Use Cases**:
  1. `src/grants/use-cases/withdraw-agreement.use-case.js:53-57`

     ```javascript
     const statusEvent = new ApplicationStatusUpdatedEvent({
       clientRef,
       code,
       previousStatus,
       currentStatus: application.getFullyQualifiedStatus(),
     });
     await insertMany(
       [
         new Outbox({
           event: statusEvent,
           target: config.sns.grantApplicationStatusUpdatedTopicArn,
           segregationRef: Outbox.getSegregationRef(statusEvent),
         }),
       ],
       session,
     );
     ```

  2. `src/grants/use-cases/withdraw-application.use-case.js:76-80`
  3. `src/grants/use-cases/approve-application.use-case.js:37-41`
  4. `src/grants/use-cases/accept-agreement.use-case.js:62-66`
  5. `src/grants/use-cases/create-status-transition-update.use-case.js:28-32`

- **SNS Topic**: `config.sns.grantApplicationStatusUpdatedTopicArn` (env: `GAS__SNS__GRANT_APPLICATION_STATUS_UPDATED_TOPIC_ARN`)
- **Target Queue**: Agreement Service's `update_agreement` SQS queue

**CloudEvent Structure**:

```json
{
  "id": "uuid",
  "source": "fg-gas-backend",
  "specversion": "1.0",
  "type": "cloud.defra.{env}.fg-gas-backend.application.status.updated",
  "datacontenttype": "application/json",
  "time": "ISO8601 timestamp",
  "data": {
    "clientRef": "string",
    "grantCode": "string",
    "previousStatus": "string",
    "currentStatus": "string"
  }
}
```

**GAS Contract Tests**:

- **Provider Test**: ❌ **MISSING** - Should be created to verify GAS sends this message

**Agreement Service Contract Tests**:

- **Consumer Test**: ❌ **MISSING** - They have `gas-agreements.withdrawn.contract.test.js` but it expects wrong event type
  - Current test expects: `agreement.withdraw` (wrong)
  - Should expect: `application.status.updated` (correct)
  - Handler: `handleUpdateAgreementEvent`
  - Action: Calls `withdrawOffer` when status indicates withdrawal

**Status**: ❌ **Tests need to be created/fixed**

---

### 2. Agreement Service → GAS (GAS as Consumer)

#### Message: `agreement.accepted`

**Purpose**: Agreement Service sends this event when a customer accepts their agreement offer.

**When**: Customer accepts the agreement in the Agreement Service UI.

**Production Code**:

- **Consumer Handler**: GAS receives and processes this via SQS message handling
- **Use Case**: `src/grants/use-cases/accept-agreement.use-case.js`
  - Processes incoming agreement acceptance
  - Updates application status
  - Sends status updates to CW

**SNS Topic**: Agreement Service's `agreement_accepted` SNS topic
**Target Queue**: GAS's `record_agreement_acceptance` SQS queue

**CloudEvent Structure** (expected by GAS):

```json
{
  "id": "uuid",
  "source": "farming-grants-agreements-api",
  "specversion": "1.0",
  "type": "cloud.defra.{env}.farming-grants-agreements-api.agreement.accepted",
  "datacontenttype": "application/json",
  "time": "ISO8601 timestamp",
  "data": {
    "clientRef": "string",
    "agreementNumber": "string",
    "date": "ISO8601 timestamp"
  }
}
```

**GAS Contract Tests**:

- **Consumer Test**: `test/contract/consumer.agreements-api.test.js` (Agreement Accepted Message)
  - Defines expectations for incoming `agreement.accepted` messages
  - Verifies message structure with matchers

**Agreement Service Contract Tests**:

- **Provider Test**: `src/contracts/provider/agreements-gas.contract.test.js`
  - Should verify Agreement Service sends messages matching GAS expectations

**Status**: ✅ **Both tests exist**

---

#### Message: `agreement_status_updated` (Acknowledgment)

**Purpose**: Agreement Service sends this event as an acknowledgment after processing GAS commands (create/withdraw).

**When**:

1. After creating an agreement offer (responds to `agreement.create`)
2. After withdrawing an agreement offer (responds to `application.status.updated`)

**Production Code**:

- **Consumer Handler**: GAS receives this as confirmation of Agreement Service actions
- Similar processing to `agreement.accepted`

**SNS Topic**: Agreement Service's `agreement_status_updated` SNS topic
**Target Queue**: GAS's queue (needs to be identified)

**CloudEvent Structure** (expected by GAS):

```json
{
  "id": "uuid",
  "source": "farming-grants-agreements-api",
  "specversion": "1.0",
  "type": "cloud.defra.{env}.farming-grants-agreements-api.agreement.status.updated",
  "datacontenttype": "application/json",
  "time": "ISO8601 timestamp",
  "data": {
    "clientRef": "string",
    "agreementNumber": "string",
    "status": "string",
    "date": "ISO8601 timestamp"
  }
}
```

**GAS Contract Tests**:

- **Consumer Test**: May be in `test/contract/consumer.agreements-api.test.js` (needs verification)

**Agreement Service Contract Tests**:

- **Provider Test**: Should exist in Agreement Service

**Status**: ⚠️ **Needs verification**

---

## Summary Table

| Direction        | Message Type              | Event Type                   | GAS Role | GAS Test Location                               | Agreements Test Location                                         | Status                |
| ---------------- | ------------------------- | ---------------------------- | -------- | ----------------------------------------------- | ---------------------------------------------------------------- | --------------------- |
| GAS → Agreements | Create Agreement Command  | `agreement.create`           | Provider | `test/contract/provider.agreements-api.test.js` | `src/contracts/consumer/gas-agreements.created.contract.test.js` | ✅ Complete           |
| GAS → Agreements | Application Status Update | `application.status.updated` | Provider | ❌ Missing                                      | ❌ Wrong (expects `agreement.withdraw`)                          | ❌ Needs creation/fix |
| Agreements → GAS | Agreement Accepted        | `agreement.accepted`         | Consumer | `test/contract/consumer.agreements-api.test.js` | `src/contracts/provider/agreements-gas.contract.test.js`         | ✅ Complete           |
| Agreements → GAS | Agreement Status Updated  | `agreement_status_updated`   | Consumer | ⚠️ Needs verification                           | ⚠️ Needs verification                                            | ⚠️ Needs verification |

---

## SNS/SQS Infrastructure

### GAS SNS Topics (Producer):

- `gas__sns__create_agreement` → Agreement Service's `create_agreement` queue
  - Publishes: `CreateAgreementCommand`

- `gas__sns__application_status_updated` → Agreement Service's `update_agreement` queue
  - Publishes: `ApplicationStatusUpdatedEvent`

### GAS SQS Queues (Consumer):

- `record_agreement_acceptance` ← Agreement Service's `agreement_accepted` SNS topic
  - Consumes: Agreement acceptance events

- Unknown queue ← Agreement Service's `agreement_status_updated` SNS topic
  - Consumes: Agreement status acknowledgments

### Agreement Service SNS Topics (Producer):

- `agreement_accepted` → GAS's `record_agreement_acceptance` queue
- `agreement_status_updated` → GAS queue
- `offer_created` (internal)

### Agreement Service SQS Queues (Consumer):

- `create_agreement` ← GAS's `gas__sns__create_agreement` SNS topic
- `update_agreement` ← GAS's `gas__sns__application_status_updated` SNS topic
- `record_offer` (internal)

---

## Common Issues

### Issue 1: Agreement Service expects `agreement.withdraw` but GAS doesn't send it

**Problem**: Agreement Service's consumer test `gas-agreements.withdrawn.contract.test.js` expects event type `agreement.withdraw`, but GAS production code sends `application.status.updated`.

**Solution Options**:

1. **Agreement Service fixes their test** to expect `application.status.updated` instead
2. **GAS creates new event** `agreement.withdraw` (not recommended - duplicates existing event)

**Recommendation**: Option 1 - Agreement Service should update their consumer test to match GAS production behavior.

---

### Issue 2: Missing provider test for `application.status.updated`

**Problem**: GAS sends `application.status.updated` to Agreement Service, but has no provider test to verify the message structure.

**Solution**: Create `test/contract/provider.agreements-api.application-status-updated.test.js` (or add to existing provider test file).

---

## Testing Strategy

### Message Provider Tests (MessageProviderPact)

Used when verifying messages **sent by** a service:

- Define the message structure in code
- Verify against consumer expectations from broker

### Message Consumer Tests (MessageConsumerPact)

Used when verifying messages **received by** a service:

- Define expected message structure
- Verify message handler processes it correctly

### Workflow Integration

Both repos use the 3-step CLI wrapper for message verification:

1. Download pacts from broker using curl
2. Run message provider tests locally
3. Publish verification results via REST API

See `docs/MESSAGE_PACT_VERIFICATION.md` for implementation details.

---

## References

**Production Code**:

- GAS Events: `src/grants/events/`
- GAS Use Cases: `src/grants/use-cases/`
- GAS Config: `src/common/config.js`
- Agreement Service Handlers: `src/api/common/helpers/sqs-message-processor/`

**Contract Tests**:

- GAS: `test/contract/`
- Agreement Service: `src/contracts/`

**Infrastructure**:

- AWS Console → SNS Topics / SQS Queues
- Pact Broker: https://ffc-pact-broker.azure.defra.cloud

---

## Next Steps

1. ✅ Create GAS provider test for `agreement.create` - **DONE**
2. ❌ Create GAS provider test for `application.status.updated` - **TODO**
3. ❌ Fix Agreement Service consumer test to expect `application.status.updated` instead of `agreement.withdraw` - **Agreements Team TODO**
4. ⚠️ Verify `agreement_status_updated` consumer test exists in GAS - **TODO**
5. ⚠️ Identify GAS queue that receives `agreement_status_updated` - **TODO**
