# Module Boundaries

## Bounded Contexts

| Module           | Path                  | Description                                                       |
| ---------------- | --------------------- | ----------------------------------------------------------------- |
| `grants`         | `src/grants/`         | Grants and Application sub-domain (grant lifecycle, applications) |
| `agreements`     | `src/agreements/`     | Agreements domain (separate bounded context)                      |
| `payments`       | `src/payments/`       | Payments domain (Payments, claim IDs, invoice numbering)          |
| `grant-admin`    | `src/grant-admin/`    | Inbound admin adapter for Entitlement and Claim operations        |
| `test-endpoints` | `src/test-endpoints/` | Inbound QA adapter for the feature-flagged `/api/test` routes     |
| `auth`           | `src/auth/`           | Authentication and authorisation                                  |
| `common`         | `src/common/`         | Shared infrastructure (logger, database, messaging clients)       |
| `events`         | `src/events/`         | Shared event domain: what an inbox/outbox event IS and means      |

## Forbidden Imports

`agreements`, `grants` and `payments` must not directly import each other's internals (models, repositories, use-cases, services, routes, schemas, etc.). The boundary is enforced in both directions, except for explicitly documented reviewed seams below. Direct cross-module imports create hidden coupling that prevents either context from evolving independently.

`grant-admin` is an inbound adapter, not a peer domain module. It validates and maps HTTP/UI concerns but does not access Grants models, repositories, schemas, use cases, or general services. Its only Grants entry points for entitlement and claim work are `grants/services/entitlement.service.js` and `grants/services/claims.service.js`. `grants` never imports from `grant-admin`, and `grant-admin` does not import from `agreements`.

`payments` knows nothing about the modules that source a Payment: it never imports `agreements` or `grants`, and it takes the identifiers it needs as plain values.

`test-endpoints` is an inbound adapter, not a peer domain module, and is registered only when `ENABLE_TEST_ENDPOINTS` is true. It deliberately reuses the Agreements command handlers so test-created data is identical to normally processed data — see [Test endpoint entry points](#test-endpoint-entry-points). `agreements` never imports from `test-endpoints`.

This is enforced by the `import-x/no-restricted-paths` rule in `eslint.config.js` and runs on every local commit (via lint-staged) and in CI (`npm run lint`).

## Allowed Integration Seams

When Agreements needs to collaborate with Grants, use one of these approved seams:

| Seam                                      | How                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP / REST API**                       | Call the Grants HTTP endpoints; do not share route handlers or controllers                                                                                                                                                      |
| **Events**                                | Publish to or consume from SNS/SQS topics; event shapes live in `src/*/events/`                                                                                                                                                 |
| **Commands**                              | Send commands via the message bus; command shapes live in `src/*/commands/`                                                                                                                                                     |
| **Inbox / Outbox records**                | Write to the shared inbox/outbox collection; poll or subscribe to the other module's outbox                                                                                                                                     |
| **Shared infrastructure**                 | Import from `src/common/` (logger, DB client, messaging helpers)                                                                                                                                                                |
| **Shared event domain**                   | Import from `src/events/` (audit predicate, list filter, status counts, facets, breakdown, redrive, retention, last error)                                                                                                      |
| **Grants → Agreements reference context** | `grants` may call the reviewed Agreements query interface for a plain reference-resolution context. The query accepts the active Mongo session; it does not expose an Agreements repository or domain model.                    |
| **Grants → Agreements status event type** | `grants` imports only `agreements/events/agreement-status-updated.event.js` to register its handler against the producer-owned exact CloudEvent type; the event still arrives through SNS/SQS.                                  |
| **Config definition checks**              | When the Config Broker publishes a version, `grants` asks each owning context whether its own definition file is usable, before the version is recorded. See [Config definition entry points](#config-definition-entry-points). |

### Grant Admin entry points

Grant Admin enters the Grants application layer through two named services. Event
administration enters the shared event module directly:

| Caller        | Entry point                                | Responsibility                                             |
| ------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `grant-admin` | `grants/services/entitlement.service.js`   | Entitlement overview and creation operations               |
| `grant-admin` | `grants/services/claims.service.js`        | Claimable-entitlement lookup and Claim submission          |
| `grant-admin` | `events/repositories/inbox.repository.js`  | Event admin: list, inspect and redrive GAS inbound events  |
| `grant-admin` | `events/repositories/outbox.repository.js` | Event admin: list, inspect and redrive GAS outbound events |

### Events domain

`src/events/` owns the durable inbox/outbox mechanism shared by every context:
the models, repositories, FIFO locks, pollers, retries, dead-letter handling,
redrive operations and event audit helpers. It also defines what an event-store
row means: which rows are audit records (`event-audit.js`), how a list of them
is selected (`event-list-filter.js`), the statuses they move through and how
they are counted and grouped (`status-counts.js`, `event-facets.js`,
`event-breakdown.js`), how long a terminal row is kept (`event-retention.js`),
what redriving one means (`event-redrive.js`), and how a failure is recorded
(`last-error.js`).

The event-store code previously lived partly in `src/common/` and partly in
`src/grants/`. Neither was a valid owner: `common` is infrastructure with no
business opinion, while the durable stores are used by Grants, Agreements,
Payments and Grant Admin. The shared events module preserves the existing
`inbox`, `outbox` and `fifo_locks` collections and their document shapes.

The rule that keeps it honest, enforced by `import-x/no-restricted-paths`:
**`src/events/` may import `src/common/` and nothing else.** A domain module
that reached into a context would tie every other context to that one, which
is the coupling moving it out of `common` was meant to end. Every module may
enter it; it enters no module.

`src/*/events/` — the per-context folders holding published event shapes — are
a different thing that shares a word. Those are one context's outbound
vocabulary; this is the shared meaning of the stores themselves.

The Grants services return plain DTOs at the adapter boundary. Grant Admin may
compose those DTOs into its banner and view models, but it must not receive or
return Grants domain objects. Event administration receives shared event rows
from `src/events/` and maps them into its own view models.

### Cross-module event contract

Inbox and internally delivered events are dispatched by exact CloudEvent type.
The `AS`, `CW` and `CB` values remain persistence and administration metadata;
they never select a handler. Unknown types fail delivery and follow the same
retry, dead-letter and redrive path as handler failures.

- Use a command for an imperative request with one owning handler. Use an event
  for an immutable fact or durable cross-module request that can be processed
  after the producer transaction commits.
- The producer owns the event contract and declares its CloudEvent type once in
  its own `events/` folder. Consumers register against that exact type; suffix
  and substring matching are forbidden.
- Persist an outbound event in the same Mongo transaction as the state change
  that caused it. Never publish before commit. The shared outbox publishes or
  dispatches it after commit and records completion independently.
- Contracts carry the immutable source snapshot and pinned configuration
  version required by the consumer. A handler must not reconstruct historical
  intent by reloading mutable source records.
- Every event has a generated delivery ID and a stable logical request identity.
  Consumers enforce the logical identity with a database uniqueness boundary so
  redelivery, concurrent delivery and transaction callback retries converge on
  one result.
- `segregationRef` is the ordering key. Events sharing it are processed in
  order; unrelated keys may progress independently.
- A failed delivery remains durable, moves through the existing retry,
  dead-letter and redrive states, and retains its failure history. Redrive
  reuses the original contract rather than rebuilding current state.
- In-process registration has one owner per exact event type. Fan-out belongs
  on SNS/SQS, where each consumer has its own queue and delivery state.
- A new cross-module event requires contract validation, exact registration,
  unknown-type and duplicate-owner checks, transaction-commit verification,
  idempotent redelivery/concurrency verification and retry/dead-letter/redrive
  coverage.

### Payment entry points

Agreement acceptance and Claim submission use named Payment use cases:

| Caller       | Entry point                                               | Why                                                                                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agreements` | `payments/use-cases/resolve-payment-definition.js`        | Resolves and validates the persisted Agreement's exact Payment definition before the transaction starts, so configuration or fetch failures write nothing                                                                                                  |
| `agreements` | `payments/use-cases/create-agreement-payment.use-case.js` | Creates the Payment in the Agreement action's Mongo session so the Payment, Agreement, Version and lifecycle event commit together                                                                                                                         |
| `grants`     | `payments/use-cases/resolve-claim-payment.js`             | Resolves the Payment a submitted Claim would raise, before the submission transaction starts. Payments owns the catalogue lookup, the definition type, the mapping context and what an unconfigured definition means; Grants passes the Claim as submitted |
| `grants`     | `payments/use-cases/create-claim-payment.use-case.js`     | Creates the Payment in the Claim submission's Mongo session so the Payment and the Claim commit together, and roll back together on any replay or retry                                                                                                    |
| `grants`     | `payments/use-cases/compile-payment-definition.js`        | Checks a published Payment definition before the config version is recorded. Payments owns what makes one unusable; Grants passes the fetched file and is told only whether it is good                                                                     |

The resolver is a read-only, pre-transaction seam. Config Broker loading and mapping validation stay outside the write transaction. The creation use case is the transactional seam, and the caller passes its session in.

A Payment definition supplies `originalInvoiceNumber` as a top-level lookup or literal mapping. It also supplies `deliveryBody` and `marketingYear` at both Payment and invoice-line levels. Invoice-line values may differ from the Payment-level values, and `payments` preserves them when it builds the Payment. `payments` generates `invoiceNumber`.

Nothing else in `payments` is importable from Agreements or Grants. Each ESLint zone lists its exceptions explicitly so adding another one is a deliberate, reviewed change.

Claim submission is transactional for the same reason Agreement acceptance is. `grants/services/claims.service.js` replays a duplicate `clientClaimRef`, retries when the Application's pinned version moves under it, and runs inside `session.withTransaction`, which may re-run the callback on a transient error. A Payment created outside that session would survive every one of those paths, so the claim ID allocation and the Payment insert take the submission's session and roll back with the Claim.

`payments` owns the shape of the Payment Service message (`payments/events/create-payment.event.js`) and returns it from the creation entry point as an outbox publication. The caller writes it to the outbox inside its own transaction, so the message commits with the Agreement while `payments` stays out of the outbox and out of publishing.

### Config definition entry points

A Config Broker version carries a definition file for each context that has one: `gas.json`
for Grants, and optionally `agreement.json` and `payment.json`. FGP-1423 checks all of them
when the event arrives, so a definition nothing can use never becomes something a grant,
agreement or payment later resolves to.

Grants runs that check because it owns the config catalogue, but it must not decide what
makes another context's definition valid. Each context exposes a narrow entry point
instead:

| Caller   | Entry point                                            | Why                                                                                                                                                                               |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grants` | `agreements/use-cases/compile-agreement-definition.js` | Checks a published Agreement definition. Also decides what is _not_ the config's fault: a missing endpoint service URL is this deployment's problem and must not fail the version |
| `grants` | `payments/use-cases/compile-payment-definition.js`     | Checks a published Payment definition. Building the model is the check                                                                                                            |

Both are pure and read-only. They fetch nothing, cache nothing, and write no fetch status —
they are told a parsed file and answer whether it is usable. That is why they are separate
files rather than exports from the loaders: whitelisting a loader would also hand Grants
`loadAgreementDefinition`, its cache and its catalogue lookups.

The two are deliberately not symmetrical. Agreements needs `checkAgreementDefinition` as
well as `compileAgreementDefinition`, because only Agreements knows that an
`EndpointServiceUrlError` means our deployment is misconfigured rather than the published
config being bad. Payments has no such case, so it exposes the compile step alone.

Grants checks its own `gas.json` through `Grant.fromDefinition`, which needs no seam.

### Test endpoint entry points

The FGP-1411 QA endpoints reuse the Agreements command handlers rather than reimplementing agreement setup, so that data created by the test suites is indistinguishable from normally processed data:

| Caller           | Entry point                                                               | Why                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `test-endpoints` | `agreements/use-cases/handle-create-agreement-command.use-case.js`        | Creates an Agreement through the same handler the SQS consumer uses, so validation, persistence and side effects match    |
| `test-endpoints` | `agreements/use-cases/handle-update-agreement-status-command.use-case.js` | Applies a status transition through the same handler, so lifecycle rules are enforced by the grant's agreement definition |
| `test-endpoints` | `agreements/use-cases/load-current-agreement.js`                          | Resolves the Agreement by number, which supplies the 404 for an unknown Agreement before any command is dispatched        |
| `test-endpoints` | `agreements/services/agreement-ownership.js`                              | Applies the same legacy denylist as the command bus before exposing test mutations                                        |

The adapter adds only HTTP concerns: the feature flag, request and response schemas, the shared Agreement ownership check, and translating a rejected transition into a 409. It holds no agreement logic of its own and never touches an Agreements repository or domain model directly. See [TEST_ENDPOINTS.md](./TEST_ENDPOINTS.md).

## Adding a New Seam

1. Define the event or command shape in the publishing module's `events/` or `commands/` directory.
2. The consuming module subscribes or polls — it does not import the publisher's internals.
3. If a new category of seam is introduced, update this document and the ESLint rule accordingly.
