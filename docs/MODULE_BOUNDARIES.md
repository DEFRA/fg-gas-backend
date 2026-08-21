# Module Boundaries

## Bounded Contexts

| Module       | Path              | Description                                                       |
| ------------ | ----------------- | ----------------------------------------------------------------- |
| `grants`     | `src/grants/`     | Grants and Application sub-domain (grant lifecycle, applications) |
| `agreements` | `src/agreements/` | Agreements domain (separate bounded context)                      |
| `payments`   | `src/payments/`   | Payments domain (Payments, claim IDs, invoice numbering)          |
| `auth`       | `src/auth/`       | Authentication and authorisation                                  |
| `common`     | `src/common/`     | Shared infrastructure (logger, database, messaging clients)       |

## Forbidden Imports

`agreements`, `grants` and `payments` must not directly import each other's internals (models, repositories, use-cases, services, routes, schemas, etc.). The boundary is enforced in both directions. Direct cross-module imports create hidden coupling that prevents either context from evolving independently.

`payments` knows nothing about the modules that source a Payment: it never imports `agreements` or `grants`, and it takes the identifiers it needs as plain values.

This is enforced by the `import-x/no-restricted-paths` rule in `eslint.config.js` and runs on every local commit (via lint-staged) and in CI (`npm run lint`).

## Allowed Integration Seams

When Agreements needs to collaborate with Grants, use one of these approved seams:

| Seam                       | How                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **HTTP / REST API**        | Call the Grants HTTP endpoints; do not share route handlers or controllers                  |
| **Events**                 | Publish to or consume from SNS/SQS topics; event shapes live in `src/*/events/`             |
| **Commands**               | Send commands via the message bus; command shapes live in `src/*/commands/`                 |
| **Inbox / Outbox records** | Write to the shared inbox/outbox collection; poll or subscribe to the other module's outbox |
| **Shared infrastructure**  | Import from `src/common/` (logger, DB client, messaging helpers)                            |

### Direct entry points

Some collaborations cannot use an event, command or HTTP seam, because a shared transaction cannot cross one. Only the named Payments use case below may be imported:

| Caller       | Entry point                                                | Why                                                                                            |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `agreements` | `payments/use-cases/prepare-agreement-payment.use-case.js` | Payments stages a Commit Operation from Agreement Action context before the transaction starts |

The ESLint zone lists this single exception explicitly, so adding another is a deliberate, reviewed change.

### Commit Operations

A **Commit Operation** is an opaque handle the staging module returns and the calling module runs inside its own transaction. Agreements never inspects one:

```js
// staged by payments, before the transaction opens
{ commit: (facts, session) => Promise<{ publication, claimId }> }
```

- **Staging happens outside the transaction.** Payments loads and resolves the Payment Definition when it stages the handle, so an invalid definition leaves the Agreement in its current state instead of failing mid-transaction. Resolving lazily inside `commit` would also hold the session open across JSONata evaluation.
- **The caller supplies only committed facts.** `{ agreementNumber, version, correlationId }` — `version` is bumped by the transition, so it cannot be captured at staging time. Payments takes plain values and never receives an Agreement.
- **The caller reads only what comes back.** The outbox publication it writes in its own transaction, and the Claim ID its own lifecycle event carries. `payments` owns the shape of the Payment Service message (`payments/events/create-payment.event.js`) but stays out of the outbox and out of publishing.
- **Commit failures propagate unwrapped.** A raced acceptance surfaces as a duplicate key error on the Payment's unique source index, and `isConcurrentActionConflict` in Agreements has to read its `keyPattern`.
- **An Agreement Action stages at most one Commit Operation**; creation and page Processes stage none. Enforced in `agreements/models/agreement-definitions/`, before the transaction opens.

Because the handle is opaque, adding a second commit source — Claims — requires no change in Agreements.

## Adding a New Seam

1. Define the event or command shape in the publishing module's `events/` or `commands/` directory.
2. The consuming module subscribes or polls — it does not import the publisher's internals.
3. If a new category of seam is introduced, update this document and the ESLint rule accordingly.
