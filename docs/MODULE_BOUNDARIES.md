# Module Boundaries

## Bounded Contexts

| Module           | Path                  | Description                                                                                     |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `grants`         | `src/grants/`         | Grants and Application sub-domain (grant lifecycle, applications)                               |
| `agreements`     | `src/agreements/`     | Agreements domain (separate bounded context)                                                    |
| `payments`       | `src/payments/`       | Payments domain (Payments, claim IDs, invoice numbering)                                        |
| `grant-admin`    | `src/grant-admin/`    | Backend-for-frontend (BFF) for `fg-grants-platform-admin`'s admin screens - not a domain module |
| `test-endpoints` | `src/test-endpoints/` | Inbound QA adapter for the feature-flagged `/api/test` routes                                   |
| `auth`           | `src/auth/`           | Authentication and authorisation                                                                |
| `common`         | `src/common/`         | Shared infrastructure and context-neutral mapping utilities                                     |
| `events`         | `src/events/`         | Shared event domain: what an inbox/outbox event IS and means                                    |

## Forbidden Imports

`agreements`, `grants` and `payments` must not directly import each other's internals (models, repositories, use-cases, services, routes, schemas, etc.). The boundary is enforced in both directions, except for explicitly documented reviewed seams below. Direct cross-module imports create hidden coupling that prevents either context from evolving independently.

`grant-admin` is a backend-for-frontend (BFF) for `fg-grants-platform-admin`, not a peer domain module - it shapes screens, `grants` owns the rules. It validates and maps HTTP/UI concerns only: no access to Grants models, repositories, schemas, use cases or general services. Its only way into Grants is five reviewed services - `entitlement.service.js`, `claims.service.js`, `application-read.service.js`, `allow-list.service.js`, `config-version.service.js`. `grants` never imports from `grant-admin`, and `grant-admin` never imports from `agreements`. See [View models vs. services](#view-models-vs-services) for the same split enforced inside `grant-admin` itself.

`payments` knows nothing about the modules that source a Payment: it never imports `agreements` or `grants`, and it takes the identifiers it needs as plain values.

`test-endpoints` is an inbound adapter, not a peer domain module, and is registered only when `ENABLE_TEST_ENDPOINTS` is true. It deliberately reuses the Agreements command handlers so test-created data is identical to normally processed data — see [Test endpoint entry points](#test-endpoint-entry-points). `agreements` never imports from `test-endpoints`.

This is enforced by the `import-x/no-restricted-paths` rule in `eslint.config.js` and runs on every local commit (via lint-staged) and in CI (`npm run lint`).

## Allowed Integration Seams

When Agreements needs to collaborate with Grants, use one of these approved seams:

| Seam                                      | How                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP / REST API**                       | Call the Grants HTTP endpoints; do not share route handlers or controllers                                                                                                                                                      |
| **Events**                                | Publish to or consume from SNS/SQS topics; event shapes live in `src/*/events/`                                                                                                                                                 |
| **Commands**                              | Send commands through the internal command target; command shapes live in `src/*/commands/`                                                                                                                                     |
| **Durable publications**                  | Pass producer-owned events or commands to `saveEvents` in the caller's transaction. Direct inbox/outbox collection access belongs to the Events module and the documented Grant Admin seam.                                     |
| **Shared infrastructure**                 | Import from `src/common/` (logger, DB client, messaging helpers)                                                                                                                                                                |
| **Shared event domain**                   | Import from `src/events/` (event type declarations, stamps, audit predicate, status values, redrive, purge, payload edits, retention, last error)                                                                               |
| **Buckets**                               | Declare a list the admin portal can show in the module that owns the collection and register it with `common/buckets/registry.js`. See [Buckets](#buckets).                                                                     |
| **Grants → Agreements reference context** | `grants` may call the reviewed Agreements query interface for a plain reference-resolution context. The query accepts the active Mongo session; it does not expose an Agreements repository or domain model.                    |
| **Grants → Agreements status event type** | `grants` imports only `agreements/events/agreement-status-updated.event.js` to register its handler against the producer-owned exact CloudEvent type; the event still arrives through SNS/SQS.                                  |
| **Config definition checks**              | When the Config Broker publishes a version, `grants` asks each owning context whether its own definition file is usable, before the version is recorded. See [Config definition entry points](#config-definition-entry-points). |
| **Config definition stores**              | Each owning context registers a store for its own file with `common/config-broker/definition-stores.js`. See [Config definition entry points](#config-definition-entry-points).                                                 |

### Grant Admin entry points

Grant Admin enters the Grants application layer through five named services, and
Payments through two named use cases. It reads a stored Agreement definition
through the definition-stores registry, and event administration enters the
shared event module directly:

| Caller        | Entry point                                                          | Responsibility                                                                                                                                              |
| ------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant-admin` | `grants/services/entitlement.service.js`                             | Claims overview, entitlement creation and update, and who may do them                                                                                       |
| `grant-admin` | `grants/services/claims.service.js`                                  | Claimable-entitlement lookup and submitted-Claim reads                                                                                                      |
| `grant-admin` | `grants/services/application-read.service.js`                        | Read-only application facts, stored documents and series                                                                                                    |
| `grant-admin` | `grants/services/allow-list.service.js`                              | Audited grant allow-list reads and transactional whole-list replacement                                                                                     |
| `grant-admin` | `grants/services/config-version.service.js`                          | Config version reads: versions, files, the stored grant, its lifecycle and entitlements, grant version existence and the audited operator Fetch Definitions |
| `grant-admin` | `common/config-broker/definition-stores.js` (`findStoredDefinition`) | A grant version's stored Agreement definition and its Service Addresses, read-only, for its Agreement tab                                                   |
| `grant-admin` | `payments/use-cases/list-claim-payments.use-case.js`                 | Which of an application's Claims have raised a Payment                                                                                                      |
| `grant-admin` | `payments/use-cases/find-stored-payment-definition.use-case.js`      | A grant version's stored Payment definition, read-only, for its admin pages                                                                                 |
| `grant-admin` | `events/repositories/inbox.repository.js`                            | Event admin: inspect, redrive, purge and edit GAS inbound events                                                                                            |
| `grant-admin` | `events/repositories/outbox.repository.js`                           | Event admin: inspect, redrive, purge and edit GAS outbound events                                                                                           |
| `grant-admin` | `common/buckets/registry.js` and `engine.js`                         | Every list: the catalogue and one query route over the declared buckets                                                                                     |

Who may see or change a grant's Claims is Grants' rule, not the BFF's. The grant
configures the roles it requires; `grants/models/claims-access.js` turns them
and the operator's roles into full, view-only or hidden access. Grant Admin
holds only how to find the operator's roles (`operator-roles.js`) and hands that
lookup to the Grants entry points, which ask for it only when the grant requires
roles: the Claims overview refuses hidden access and reports the access it
decided, and entitlement creation and update refuse anything short of full
access. Claim submission is not one of these - the applicant-facing Grants UI
calls it, for an applicant rather than a Caseworking operator.

The Claims page is a read-model join across two contexts: Grants resolves a
Claim against the template it was made under, Payments answers whether it has
raised a Payment, and `grant-admin` puts the two together. Neither context
imports the other.

### View models vs. services

`grant-admin` is a BFF (see above) - so its own code has to stay a BFF too, not
quietly grow a second domain layer.

`services/` is a flat catch-all. Some of it prepares data for a view
(`build-banner.js` resolves the banner's references and refuses a grant with
none); some of it does more (`operator-roles.js` asks Caseworking for the
operator's roles and throws Boom when they cannot be determined). Nothing stops
a `services/` file reaching into a repository or a domain service directly -
that split is a naming convention, not a rule.

`view-models/` is the enforced version: `import-x/no-restricted-paths` lets a
file there import only another view-model, nothing else. A route still does
both steps - resolve data via `services/` or a domain entry point, then shape
it via `view-models/` - the same two steps `get-claims.route.js` takes with
`build-banner.js` and `build-claims-view.js`.

This is where we want all of `grant-admin`'s screen-shaping to land, one
screen at a time. `build-allow-list-view.js` is the first, since it was new
work rather than a migration. Claims is the second: `build-claims-view.js` now
lives there and receives the banner already resolved by `build-banner.js`.
Events, cases and applications follow the same path, each its own change.

### Events domain

`src/events/` owns the durable inbox/outbox mechanism shared by every context:
the models, repositories, FIFO locks, pollers, retries, dead-letter handling,
redrive, purge and payload-edit operations, and event audit helpers. It also defines what an
event-store row means: which event types this service sends and receives
(`event-types.js`, declared by each context beside its event class), the facts
and refs a writer stamps on a row at insert (`stamps.js`), which rows are audit
records (`event-audit.js`), the statuses they move through
(`event-status-values.js`), the lists the admin portal can show of them
(`buckets/`), how long a terminal row is kept
(`event-retention.js`), what redriving one means (`event-redrive.js`), what
purging one means (`event-purge.js`), what editing one's payload means
(`event-edit.js`, with `payload-changes.js` for what an edit changed and
`plain-json.js` for whether a payload survives one), and how a failure is
recorded (`last-error.js`).

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

### Event and command ownership

The producing context owns each event or command contract and constructs it from
its domain state. Use cases hand ordered publications to `saveEvents` as
`{ event, target, segregationRef? }` values in the caller's transaction. They do
not construct `Outbox` records or call the outbox repository directly.

The Events module exclusively owns Outbox construction, persistence and default
segregation-reference derivation. A producer may supply `segregationRef` when it
needs a domain-specific processing lane or ordering boundary instead of the
derived default. Consumers own their handlers and register against the producer's
exact contract type; consuming a contract does not transfer ownership of its
vocabulary.

ESLint enforces this persistence boundary throughout the Agreements, Grants and
Payments producer modules. Producer unit tests should mock `events/index.js` and
assert against `saveEvents`, rather than mock an Outbox model or repository that
belongs behind the facade. Integration tests may inspect persisted event rows
when verifying durable behaviour.

### Payment event interface

Agreements and Grants do not import Payments. They commit producer-owned request
events with their own state changes:

| Producer     | Contract                                                 | Payments handler                                          |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------- |
| `agreements` | `agreements/events/agreement-payment-requested.event.js` | `payments/handlers/handle-agreement-payment-requested.js` |
| `grants`     | `grants/events/claim-payment-requested.event.js`         | `payments/handlers/handle-claim-payment-requested.js`     |

Both requests use the explicit `internal:event` outbox target. The outbox
dispatches the exact CloudEvent type after the producer transaction commits;
`internal:message-bus` remains the stored command target for rolling-deploy compatibility. An unknown event type fails
and follows the normal retry, dead-letter and Admin redrive path. It is never
reinterpreted as a command.

The producer event contains a stable request identity, pinned configuration
version and immutable snapshot. Payments resolves its definition, maps the
snapshot, allocates the Payment Hub identifier, writes the Payment and creates
the external Payment Service event in its own transaction. Its uniqueness
indexes make repeated or concurrent delivery converge on one Payment and one
publication.

A Payment definition supplies `originalInvoiceNumber` as a top-level lookup or
literal mapping. It also supplies `deliveryBody` and `marketingYear` at both
Payment and invoice-line levels. Invoice-line values may differ from the
Payment-level values, and Payments preserves them when it builds the Payment.
Payments generates `invoiceNumber`.

No production import may cross from Agreements or Grants into Payments; ESLint
has no exception for a Payment use case, model or helper. Payments likewise
imports neither producer context. The event contract and the handler are the
entire runtime interface.

Grant Admin exposes failed internal request rows with their exact event type,
request payload, last error and attempt history. Redrive changes only delivery
state: it retains that original contract, target and failure evidence, allowing
a corrected mapping or publication dependency to retry safely without
reconstructing producer state.

### Config definition entry points

A Config Broker version carries a definition file for each context that has one: `gas.json`
for Grants, and optionally `agreement.json` and `payment.json`. FGP-1423 checks all of them
when the event arrives, so a definition nothing can use never becomes something a grant,
agreement or payment later resolves to.

Grants runs that check because it owns the config catalogue, but it must not decide what
makes another context's definition valid. Agreements exposes its reviewed definition
check. Payments registers its check with the context-neutral registry in
`common/config-broker/definition-checks.js` when the Payments plugin starts, so Grants
does not import Payments to invoke it.

Both checks are read-only. They fetch nothing, cache nothing, and write no fetch status;
they are given a parsed file and answer whether it is usable. Agreements additionally
knows that an `EndpointServiceUrlError` is a deployment fault rather than a bad published
definition and therefore must not poison the config version.

Grants checks its own `gas.json` through `Grant.fromDefinition`, which needs no seam.
On top of building the `Grant`, it checks the published grant definition schema and builds
the definition's `GrantLifecycle` (phases, stages and statuses with unique codes, each
`validFrom` resolving to a position under the runtime's own rules, and no status with
`validFrom` carrying its own processes, which would never run) and `ExternalStatusMap`
(every `mappedTo` resolving to a position), and checks that every amendable position
exists. It is given the process and questions checks the runtime uses, so every process
must have a handler and each phase's `questions` must compile with the answers validator.
A stored grant is built by the constructor alone and is not held to these rules.

The admin's grant version page shows which of a version's files GAS has stored. Grants
answers that for its own `gas.json`; for the others it asks the context-neutral registry in
`common/config-broker/definition-stores.js`, where Agreements and Payments each register a
store for their own file when their plugin starts. A store's `storedVersions` is a read
only: it fetches nothing and writes no fetch status. A store may also offer a read-only
`find` of its stored definition; Agreements does, because Grant Admin may not import
Agreements.

An operator's Fetch Definitions stores the files a version still lacks. Grants decides
which files and in what order, and fetches each from S3; it never writes `config_versions`.
Each owning context registers one `store` operation with the same registry, which holds its
file to the check it met on arrival, stores it as published, counts a file already stored
as stored, and writes no fetch status. Grants calls it for an operator's Fetch Definitions,
never for a broker message. Grants holds its own `gas.json` to its arrival check before it
saves it, and refuses one whose code is not the version's grant.

### Test endpoint entry points

The FGP-1411 QA endpoints reuse the Agreements command handlers rather than reimplementing agreement setup, so that data created by the test suites is indistinguishable from normally processed data:

| Caller           | Entry point             | Why                                                                                                                                         |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-endpoints` | `agreements/testing.js` | Explicitly exports only Agreement creation, status transition, current lookup and ownership checks needed by the feature-flagged QA adapter |

The adapter adds only HTTP concerns: the feature flag, request and response schemas, the
shared Agreement ownership check, and translating a rejected transition into a 409. It
holds no agreement logic of its own and never touches an Agreements repository or domain
model directly. ESLint permits this one Agreements entry point and rejects every other
production Agreements import made by `test-endpoints`. See [TEST_ENDPOINTS.md](./TEST_ENDPOINTS.md).

### Buckets

A bucket is one list the admin portal can show: one collection, with the facts
a filter or grouping may name, the ref kinds a search may name, a time field
and its index lines. A fact may lead every index key (`lead`), and a value of
a fact may stay out of the list until a switch shows it (`hidden`, `toggle`):
`gas.outbox` leads with its event type and hides the `audit` type that way,
because that type is declared `hiddenByDefault`. It is declared
once, with `defineBucket`, in the module that owns the collection, and
registered with `registerBucket` when that module's plugin starts:

| Bucket             | Declared in                             | Registered by     |
| ------------------ | --------------------------------------- | ----------------- |
| `gas.outbox`       | `events/buckets/outbox.bucket.js`       | `events/index.js` |
| `gas.inbox`        | `events/buckets/inbox.bucket.js`        | `events/index.js` |
| `gas.applications` | `grants/buckets/applications.bucket.js` | `grants/index.js` |
| `gas.grants`       | `grants/buckets/grants.bucket.js`       | `grants/index.js` |

`src/common/buckets/` is the engine: it turns any query into one read on one
named index, and says whether that read was exact or bounded. It imports
nothing but `common`, knows no collection and no bucket, and is the same code
in `fg-cw-backend`. `grant-admin` serves every bucket through
`GET /grant-admin/buckets` and `POST /grant-admin/buckets/{bucketId}/query`; it
reads the registry, never a declaration, so a new bucket needs no route and no
`grant-admin` change. A bucket whose id begins `cw.` is forwarded to
Caseworking by that id.

A new bucket is a declaration, one `registerBucket` line, `refs` built by the
collection's writer, and one migration that backfills `refs` and calls
`ensureIndexes`. A migration imports a bucket factory by path and never reads
the registry, which is empty until the plugins have started.

## Adding a New Seam

1. Define the event or command shape in the publishing module's `events/` or `commands/` directory.
2. The consuming module subscribes or polls — it does not import the publisher's internals.
3. If a new category of seam is introduced, update this document and the ESLint rule accordingly.
