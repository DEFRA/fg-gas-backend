# ADR-001: Audit Event Delivery via Outbox Pattern with Proxy Wrapper

**Status:** Accepted | **Date:** 2026-06-22 | **Ticket:** FGP-1116 | **Branch:** spike/FGP-1116-proxy

This document records the design decision for how fg-gas-backend publishes compliance and security audit events to FCP Audit, the approaches explored during the spike (spike/FGP-1116), and the reasoning behind the chosen solution.

## Overview

FCP Audit is a shared Grants Platform service that persists compliance events (audit trail) and security events (Protective Monitoring → SOC). All write paths in fg-gas-backend that create or mutate grant applications must publish to it.

The key constraints driving the design are:

- Audit events must reflect the **outcome** of the business operation (SUCCESS or FAILURE)
- An audit event that fires for a business operation that was subsequently rolled back creates a false record — this is worse than no audit event
- An audit event lost after a successful business write is a compliance gap
- The wrapping mechanism must not require changes to every call site and must keep `withTransaction` as a single-concern utility

## Architecture

```
HTTP Request
      │
      ▼
server.js (onRequest)
  withRequestContext({ user, subject, sessionId, ip })
      │
      ▼
Route Handler → Use Case
      │
      ▼
withAudit(fn, dataBuilder)              ← Proxy wrapping the inner function
      │
      ├── await fn(...args)             ← runs inside existing withTransaction session
      │
      └── finally:
            dataBuilder(args, result)
            writeAuditEvent(...)        ← insertMany([outboxEntry], session)
                  │                        same Mongoose session = same transaction
                  ▼
            MongoDB Outbox
                  │
                  ▼
            OutboxSubscriber → SNS → FCP Audit SQS
```

The audit `Outbox` entry is written into the same MongoDB transaction as the business write, so it commits or rolls back atomically with the business state.

## Production Code

| File                              | Role                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/common/with-audit.js`        | Proxy wrapper — intercepts `apply`, runs target, calls `writeAuditEvent` in `finally`                        |
| `src/common/write-audit-event.js` | Builds FCP Audit payload, validates with `@defra/fcp-audit-publisher`, inserts to outbox                     |
| `src/common/audit-constants.js`   | `buildAuditEvent` helper, `auditEntities` and `auditActions` enums                                           |
| `src/common/request-context.js`   | AsyncLocalStorage store for `user`, `subject`, `sessionId`, `ip` — populated per HTTP request in `server.js` |
| `src/server.js`                   | `onRequest` extension that wraps `_lifecycle` / `_postCycle` with `withRequestContext`                       |

### Wiring a use-case

The inner function (the write operation) is extracted and wrapped separately from the exported use-case. `withAudit` returns a Proxy that is transparent to callers.

```js
const writeStatusTransition = async ({ clientRef, code, previousStatus, currentStatus }, session) => {
  await insertMany([new Outbox({ ... })], session);
};

const auditDataBuilder = (args) => {
  const [{ clientRef, code, previousStatus, currentStatus }] = args;
  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.STATUS_TRANSITION,
    entityid: clientRef,
    details: { code, fromStatus: previousStatus, toStatus: currentStatus },
  });
};

const writeStatusTransitionWithAudit = withAudit(writeStatusTransition, auditDataBuilder);
```

## Spike History

Three approaches were explored on `spike/FGP-1116` before arriving at the current solution.

### 1. `withAuditEvents` Higher-Order Function, Direct SNS Publish

**Explored in:** `spike/FGP-1116` (commit `a564b7f`)

Use-cases are wrapped with `withAuditEvents(fn, buildAuditEvent)`, which runs the use-case then publishes directly to SNS in a `finally` block (fire-and-forget via `.catch()`).

```js
export const createApplicationUseCase = withAuditEvents(
  async (code, application) => { /* ... */ },
  ({ args, result, status, context }) => ({
    audit: { eventtype: 'ApplicationCreation', ... },
  })
);
```

**Pitfalls:**

- **No transactional consistency.** The audit event is published to SNS after the business operation, but the SNS publish is completely decoupled from the MongoDB transaction. If the write later rolls back (e.g. due to a write conflict) the audit record is wrong.
- **Session not available.** The wrapper sits outside `withTransaction` so it cannot pass the active MongoDB session to the audit write — the audit event cannot be written transactionally from this position.
- **Wrong abstraction boundary.** The `finally` block runs after the Promise returned by the wrapped function resolves, which is after `withTransaction` has already committed.

---

### 2. Audit Callback Threaded Through `withTransaction`

**Explored in:** `spike/FGP-1116` (commit `5361b6e`)

`withTransaction` was extended with a second parameter `onAudit`, which it calls inside the transaction on success and outside (with no session) on failure.

```js
export const withTransaction = async (callback, onAudit, options) => {
  await session.withTransaction(async (session) => {
    await callback(session);
    if (onAudit) await onAudit(session).catch(...);
  });
  // on catch: onAudit() called with no session
};
```

**Pitfalls:**

- **Pollutes a general-purpose utility.** `withTransaction` is used by every write path in the service. Adding audit concerns to it couples every future use to the audit subsystem, even use-cases that don't need auditing.
- **Breaks the function signature.** All existing call sites using positional `options` as the second argument would need updating.
- **Audit concerns leak upward.** Every use-case must construct and pass an `onAudit` callback, duplicating the wrapping logic at the call site rather than centralising it.

---

### 3. `withAudit({ run, audit, transactional, getSession })`

**Explored in:** `spike/FGP-1116` (commit `1a9449e`)

A unified `withAudit` function accepted a config object. For transactional use-cases it managed `withTransaction` internally; for others it used an unmanaged try/finally path with an optional `getSession` extractor.

```js
export const replaceApplicationUseCase = withAudit({
  transactional: true,
  run: replaceApplication,
  audit: ({ args }) => buildAuditEvent({ ... }),
});
```

**Pitfalls:**

- **Caller must know transaction mode.** Requiring `transactional: true` means the wrapper is tightly coupled to transaction management. If a use-case changes from unmanaged to transactional (or vice versa) the audit wrapper must be updated too.
- **`withAudit` re-implements transaction management.** The wrapper calls `withTransaction` internally, doing two jobs: auditing and transaction management. This makes the abstraction harder to reason about and test in isolation.
- **`withTransaction` still mutated.** This approach still required the `onAudit` callback parameter on `withTransaction`, so Approach 2's downsides were not fully resolved.

## Benefits

- **Transactional consistency.** The audit outbox entry is written in the same MongoDB transaction as the business write. If the transaction rolls back, the audit entry is never written — there is no window in which the business state is committed but the audit event is absent.
- **Delivery guarantee via outbox.** The outbox subscriber handles retry, ordering (FIFO topic), and dead-letter — the same guarantees that all other domain events already have.
- **`withTransaction` stays clean.** No audit parameters leak into the general-purpose transaction utility.
- **Transparent to callers.** A Proxy is indistinguishable from the original function at the call site — no change required to anything that calls the wrapped function.
- **Identity extracted automatically.** `writeAuditEvent` reads from `getRequestContext()` (ALS), so use-case factories do not need to handle user/subject/IP concerns.

## Pitfalls and Trade-offs

- **FAILURE audit events have weaker durability than SUCCESS events.** On success, the audit `Outbox` entry is written inside the same MongoDB transaction as the business write — they commit or roll back atomically. On failure, the proxy sets `session = null` before firing the audit write, so `writeAuditEvent` attempts a standalone out-of-transaction insert. This is fire-and-forget: if the write fails (MongoDB unavailable, transient error) the FAILURE event is silently dropped. Note that wrapping the call in try/catch would not help here — if the outbox insert itself fails, the event is gone regardless. What could be improved is the error logging: the `.catch()` handler should log `"Unable to write FAILURE audit event"` (or `"Unable to write SUCCESS audit event"` on the success path) to make it explicit which type of event was lost. The asymmetry is worth noting for compliance: missing a FAILURE record is less damaging than a spurious SUCCESS, but it is still a gap.

- **Session convention is implicit.** The proxy passes `args[1]` as the session for most inner functions, but this is a convention not a type contract. A use-case whose session is not in position 1 will silently pass the wrong value. Each wrapper must be inspected when wiring a new use-case.

- **SQS-driven use-cases have no request context.** When a use-case is triggered by SQS (no HTTP request), `getRequestContext()` returns `null`, so `user`, `sessionId`, and `subject` are omitted from the audit event. This is intentional — service-to-service events use the service IP as identity — but the validation behaviour of `@defra/fcp-audit-publisher` with these fields absent should be confirmed.

- **FIFO topic conditional is a behaviour change.** The fix to `sns-client.js` (only add `MessageGroupId` for `.fifo` topics) silently changes behaviour for non-FIFO topics that were previously receiving `MessageGroupId`. Callers should confirm this is intentional for each topic.

- **Infrastructure dependency.** Audit events are written to an outbox targeting `config.sns.auditTopicArn`. The SNS topic (`fg-gas-audit`) and its `fcp_audit` SQS subscriber must exist in each environment before audit events can be delivered. This is an infrastructure prerequisite out of scope for this branch.

## Alternatives Not Explored

- **Direct SNS publish with eventual consistency accepted.** Simpler, but the compliance requirement for an accurate audit trail rules this out.
- **MongoDB change streams.** Would allow audit events to be derived from DB changes without code instrumentation, but requires significant infrastructure and is inconsistent with the outbox pattern already established for domain events.

## References

- **Production Code:** `src/common/with-audit.js`, `src/common/write-audit-event.js`, `src/common/audit-constants.js`
- **Request Context:** `src/common/request-context.js`, `src/server.js`
- **Use-case examples:** `src/grants/use-cases/create-status-transition-update.use-case.js`, `src/grants/use-cases/replace-application.use-case.js`, `src/grants/use-cases/withdraw-application.use-case.js`
- **FCP Audit publisher:** `@defra/fcp-audit-publisher`

## Next Steps

1. ⚠️ Improve `.catch()` error logging in `with-audit.js` to identify which event type failed to write
2. ⚠️ Confirm `@defra/fcp-audit-publisher` validation behaviour when `user`/`sessionId` are absent (SQS-driven paths)
3. ⚠️ Confirm `MessageGroupId` removal is intentional for non-FIFO topics
4. ❌ Infrastructure: create `fg-gas-audit` SNS topic and add `fcp_audit` SQS as a subscriber in each environment
