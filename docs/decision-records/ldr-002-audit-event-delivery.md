# Lightweight Decision Record - Audit Event Delivery in GAS

|                  |                            |
| ---------------- | -------------------------- |
| status           | proposed                   |
| date             | 23 Jun 2026                |
| decision makers  | Julian Kimmings            |
| people consulted | Martin Smith, Justin Remel |
| people informed  | Core Grants Team           |

## Context and Problem Statement

FCP Audit is a shared Grants Platform service that persists compliance records and forwards security events to the SOC. All significant write paths in `fg-gas-backend` need to publish to it.

The complication is that all significant writes in the service run inside MongoDB transactions. Any audit mechanism has to answer three questions: when does the audit event get written relative to the transaction, what happens if the business operation fails, and what happens if the audit write itself fails.

An audit event that fires for an operation that subsequently rolled back creates a false compliance record. An audit event lost after a successful write is a compliance gap. The chosen mechanism must address both without adding audit concerns to `withTransaction`, which is a general-purpose utility used across the whole service.

## Decision Drivers

- **Correctness**: audit events must reflect the actual outcome of the business operation.
- **Atomicity**: a successful write and its audit record must not be separable.
- **Separation of concerns**: `withTransaction` must not carry audit parameters.
- **Low call-site burden**: instrumenting a use-case must not require changes to its callers.

## Considered Options

### 1. Higher-order function with direct SNS publish

Wrap each use-case with a higher-order function that runs the operation then publishes directly to SNS in a `finally` block (fire-and-forget).

Good, because it is simple to implement and understand.

Bad, because the wrapper sits outside `withTransaction` so it has no access to the MongoDB session. The audit publish happens after the transaction has already committed or rolled back — there is no way to make the audit atomic with the business write.

Bad, because a transient SNS failure silently drops the event with no retry path.

### 2. `onAudit` callback threaded through `withTransaction`

Extend `withTransaction` with a second `onAudit` parameter. Call it inside the transaction on success and in the catch block on failure.

Good, because the audit write runs inside the same transaction as the business operation on the success path.

Bad, because `withTransaction` is a general-purpose utility. Adding audit parameters to its signature means every call site becomes aware of the audit subsystem, even use-cases that do not need auditing.

Bad, because it breaks the existing function signature for callers that use the second positional argument for options.

### 3. Config-object wrapper (`withAudit({ run, audit, transactional, getSession })`)

A unified wrapper that accepts a configuration object. `transactional: true` makes the wrapper manage its own `withTransaction` call. `getSession` extracts the outer transaction's session from the use-case's own arguments for side-effect use-cases.

Good, because a single wrapper handles both transactional and non-transactional use-cases.

Good, because callers do not change.

Bad, because the wrapper manages two concerns — auditing and transaction management. If a use-case's transaction strategy changes, the audit wrapper configuration must also change.

Bad, because `getSession` encodes the positional index of the session argument inside the callee's signature — implicit knowledge baked into configuration at the call site.

Bad, because it still requires the `onAudit` mutation to `withTransaction`, so the concerns from Option 2 are not fully resolved.

### 4. Proxy wrapper (`withAudit(fn, dataBuilder)`)

`withAudit` returns a JavaScript `Proxy` of the inner function. The proxy's `apply` trap intercepts each call, runs the original function, captures the outcome, then writes the audit event to the outbox in a `finally` block. The audit outbox entry is written with the active MongoDB session, which is passed by convention as the second argument to all wrapped inner functions.

Good, because `withTransaction` is completely unmodified. Audit concerns are isolated to the proxy.

Good, because the audit outbox entry is written inside the same MongoDB session as the business write on the success path — it commits or rolls back atomically.

Good, because the proxy is transparent. A `Proxy` has the same call interface as the original function, so no call site needs to change.

Good, because transaction management stays with the use-case. Use-cases that need a transaction call `withTransaction` themselves and pass the session into the inner audited function. The proxy picks up the session without any configuration.

Good, because audit events go through the existing outbox subscriber, inheriting its retry and dead-letter guarantees.

Bad, because the session convention (`args[1]`) is implicit. A use-case whose session is not the second argument will silently pass the wrong value.

Bad, because failure audit events are written outside the transaction (session is set to `null` on the failure path) so a transient outbox write failure at that moment silently drops the failure record.

## Decision Outcome

Option 4 — proxy wrapper.

`withAudit(fn, dataBuilder)` wraps the inner write function as a Proxy. The use-case export manages its own transaction externally and passes the session as the second argument to the wrapped function. The audit outbox entry is committed or rolled back atomically with the business write on the success path.

The outbox delivers audit events to the FCP Audit SNS topic asynchronously. No changes are made to `withTransaction` or to any existing call site.

## Consequences

All significant write paths must instrument their inner write function (not the exported use-case) with `withAudit`. The session must be the second argument of every wrapped function.

Failure audit events are written outside any transaction. A transient MongoDB write failure at that point silently drops the event. This is a residual risk with the "fire and forget" pattern - we capture errors here and log them.

The audit SNS topic must be a standard topic (not FIFO), because the FCP Audit SQS subscriber is not a FIFO queue. The existing `sns-client.js` required a fix to include `MessageGroupId` only for topic ARNs ending in `.fifo`.

Identity fields (`user`, `sessionid`) are absent from audit events triggered by SQS-driven paths, because no HTTP request context is available.

## More Information

Supporting detail: [Audit event delivery — proxy approach](../AUDIT_EVENT_DELIVERY.md).
