# Contract Verification Issues

## Consumer: farming-grants-agreements-api

This document outlines the mismatches between what the consumer expects and what our current implementation provides.

---

## Issue 1: Agreement Created Message

**Event Type:** `agreement.create`
**Status:** ❌ MISMATCH

### What Consumer Expects:

```json
{
  "type": "cloud.defra.test.fg-gas-backend.agreement.create",
  "data": {
    "agreementNumber": "SFI987654321",
    "clientRef": "client-ref-002",
    "code": "frps-private-beta",
    "identifiers": {
      "sbi": "106284736",
      "frn": "frn",
      "crn": "crn"
    },
    "answers": {
      "applicant": {
        "business": {
          "phone": "01234031670" // ❌ STRING expected
        }
      }
    },
    "createdAt": "2025-08-19T09:36:45.131Z", // ❌ MISSING
    "submittedAt": "2025-08-19T09:36:44.509Z", // ❌ MISSING
    "notificationMessageId": "sample-notification-2" // ❌ MISSING
  }
}
```

### What We Currently Send:

```json
{
  "type": "cloud.defra.test.fg-gas-backend.agreement.create",
  "data": {
    "clientRef": "client-ref-002",
    "code": "frps-private-beta",
    "identifiers": { ... },
    "metadata": { ... },
    "answers": {
      "applicant": {
        "business": {
          "phone": {              // ❌ OBJECT (should be STRING)
            "mobile": "01234031670"
          }
        }
      }
    }
    // ❌ Missing: agreementNumber, createdAt, submittedAt, notificationMessageId
  }
}
```

### Required Changes:

#### Option A: Update Provider (fg-gas-backend)

Modify `src/grants/events/create-agreement.command.js`:

```javascript
export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    super("agreement.create", {
      agreementNumber: application.agreementNumber, // ADD
      clientRef: application.clientRef,
      code: application.code,
      identifiers: application.identifiers,
      metadata: application.metadata,
      answers: application.getAnswers(), // Ensure phone is string
      createdAt: application.createdAt, // ADD
      submittedAt: application.submittedAt, // ADD
      notificationMessageId: application.notificationMessageId, // ADD
    });
  }
}
```

**AND** ensure the Application domain model's `phone` field is a string, not an object.

#### Option B: Update Consumer Contract

Ask the `farming-grants-agreements-api` team to:

- Remove expectations for `agreementNumber`, `createdAt`, `submittedAt`, `notificationMessageId`
- Accept `phone` as an object with `mobile` property

---

## Issue 2: Agreement Withdrawn Message

**Event Type:** `agreement.withdraw`
**Status:** ❌ MISMATCH

### What Consumer Expects:

```json
{
  "type": "cloud.defra.test.fg-gas-backend.agreement.withdraw", // ❌ .withdraw
  "data": {
    "agreementNumber": "SFI123456789",
    "clientRef": "client-ref-002",
    "status": "withdrawn"
  }
}
```

### What We Currently Send:

```json
{
  "type": "cloud.defra.test.fg-gas-backend.agreement.status.update", // ❌ .status.update
  "data": {
    "clientRef": "client-ref-002",
    "status": "withdrawn",
    "agreementNumber": "SFI123456789"
  }
}
```

### Required Changes:

#### Option A: Create New Event for Withdraw

Create `src/grants/events/withdraw-agreement.command.js`:

```javascript
import { CloudEvent } from "../../common/cloud-event.js";

export class WithdrawAgreementCommand extends CloudEvent {
  constructor(command) {
    super("agreement.withdraw", {
      // Use .withdraw type
      clientRef: command.clientRef,
      status: command.status,
      agreementNumber: command.agreementNumber,
    });
  }
}
```

**AND** use this command specifically for withdrawal scenarios instead of `UpdateAgreementStatusCommand`.

#### Option B: Update Consumer Contract

Ask the `farming-grants-agreements-api` team to:

- Accept event type `agreement.status.update` for withdrawals
- Or create a separate contract for `agreement.status.update` events

---

## Recommendation

**Coordinate with the farming-grants-agreements-api team** to decide:

1. **Are these fields actually needed by them?**
   - If yes → Implement Option A changes
   - If no → They should update their contract (Option B)

2. **Should withdraw be a separate event type?**
   - This is a design decision that affects event semantics
   - Current: Generic status update
   - Proposed: Specific withdrawal event

3. **Phone field structure**
   - Current backend likely has phone as object throughout
   - Changing this could be a significant refactor
   - Verify if consumer really needs string, or if they can accept object

---

## Contract Test Files

- **Test File:** `test/contract/provider.agreements-api.verification.test.js`
- **Consumer Contract Source:** `https://ffc-pact-broker.azure.defra.cloud/pacts/provider/fg-gas-backend/consumer/farming-grants-agreements-api/latest`

## Next Steps

1. ✅ Document issues (this file)
2. ⏳ Discuss with farming-grants-agreements-api team
3. ⏳ Decide on approach (Provider changes vs Consumer changes)
4. ⏳ Implement agreed changes
5. ⏳ Verify contract tests pass
6. ⏳ Publish verification results

---

**Created:** 2026-01-26
**Related Ticket:** FGP-789
