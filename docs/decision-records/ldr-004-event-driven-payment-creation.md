# Lightweight Decision Record - Event-driven Payment Creation in GAS

|                  |                  |
| ---------------- | ---------------- |
| status           | accepted         |
| date             | 18 Sep 2026      |
| decision makers  | Core Grants Team |
| people consulted | Martin Smith     |
| people informed  | Core Grants Team |

## Context and Problem Statement

Before this decision, Claims and Agreements called Payments use-cases directly. The caller resolved the Payment definition before starting its transaction, then passed the transaction session into Payments so the source record, Payment, Payment Hub event and durable event records committed or rolled back together.

This preserved synchronous failure behaviour, but it made Claims and Agreements depend on Payments internals and gave the source modules responsibility for coordinating Payment persistence and publication. It also left the durable event infrastructure inside Grants even though Agreements, Payments and other modules needed the same capability.

GAS must match the external Payment Hub event payload and transport interface. It does not need to reproduce the internal data model or allocation timing of the legacy Farming Agreements API. Compatibility with the legacy Agreement HTTP response and Agreement lifecycle event is a separate cutover obligation; this decision must not be read as evidence that those interfaces can change.

The decision needed to establish how Claims and Agreements would request Payments without importing Payments code, how Payment definition failures would be handled, and how Payment Hub identifiers would be allocated without producing duplicates under at-least-once delivery.

## Decision Drivers

- **Clear ownership**: Claims and Agreements own their source events; Payments owns Payment creation and the Payment Hub interface.
- **Module independence**: Claims and Agreements must not import Payments models, repositories or use-cases.
- **Reliable delivery**: committed source changes must not lose their Payment request.
- **Idempotency**: retries and redelivery must not create another Payment, identifier or external event.
- **Scheduled payments**: one Payment Hub request must carry every scheduled payment due under that request.
- **Interface compatibility**: emitted Payment events must retain the Payment Hub payload and transport contract, including the CloudEvent envelope, `claimId`, `paymentRequestNumber`, `invoiceNumber` and the `payments` array.
- **Operational recovery**: runtime mapping and delivery failures must be visible and redrivable.
- **Incremental migration**: the direct and event-driven creation paths must not create Payments concurrently.

## Considered Options

### 1. Keep direct Payments use-case calls

Claims and Agreements continue to resolve Payment definitions and call Payments inside their own MongoDB transactions.

Good, because Payment validation and persistence fail the source operation synchronously.

Good, because the source record, Payment and external event are committed in one transaction.

Bad, because Claims and Agreements import Payments internals and coordinate Payment behaviour.

Bad, because Payments does not own its transaction or runtime boundary.

### 2. Add a synchronous Payments preparation port

Claims and Agreements call a narrow Payments interface before committing, then raise an asynchronous request after validation succeeds.

Good, because it preserves most current fail-closed behaviour.

Bad, because the source operation still has a synchronous runtime dependency on Payments.

Bad, because naming the dependency as a port hides rather than removes the coupling.

### 3. Use producer-owned Payment request events

Claims and Agreements commit their state with a durable, producer-owned Payment request event. Payments handles the event asynchronously in its own transaction.

Good, because each module owns its data, contracts and transaction boundary.

Good, because at-least-once delivery can use the existing retry, dead-letter and Admin redrive capabilities.

Good, because Payments becomes the sole owner of Payment creation and Payment Hub publication.

Bad, because a source operation can commit before a runtime Payment mapping failure is discovered.

Bad, because correctness depends on explicit request idempotency under at-least-once delivery.

### 4. Introduce a pending source workflow

Claims and Agreements enter a pending state, raise a Payment request, then complete only after `PaymentCreated` or fail after `PaymentRejected`.

Good, because source completion remains fail-closed without a direct module call.

Bad, because it introduces more states, response events and process management than the current requirement needs.

Bad, because operational Payment configuration failures become part of the applicant-facing source lifecycle.

## Decision Outcome

Option 3 - producer-owned Payment request events.

Claims raises `ClaimPaymentRequested` from the Grants module. Agreements raises `AgreementPaymentRequested` from the Agreements module. The event contracts are owned by their producers and include an immutable source snapshot, source identity, configuration version, original execution time and stable request identity required by Payments. Neither producer imports Payments code.

Payments registers its own runtime plugin and handles both event types. A handler resolves the applicable Payment definition, creates or finds the idempotent Payment, allocates Payment Hub identifiers, and records the external `io.onsite.agreement.create-payment` event in a Payments-owned transaction.

The existing durable MongoDB event mechanism moves from Grants/Common into shared event infrastructure under `src/events/`. It dispatches incoming events by event type and retains at-least-once delivery, retries, dead-lettering, Admin inspection and redrive. Domain and application code refer to raising and handling events rather than inbox or outbox implementation details.

## Payment Definition Validation

Configuration ingestion already has a whole-version readiness gate. Before a version is recorded, `validateConfigDefinitions` fetches and compiles every declared Grant, Agreement and Payment definition. A missing optional `payment.json` is a valid no-op. The check deliberately writes no fetch status: it proves that the version is usable rather than putting a definition into service.

The event-driven path extends that existing capability by loading the Payment definition for the request's exact pinned version and by separating configuration failures from data-dependent mapping failures. Ingestion-time validation can prove the definition's structure and expression syntax, but it cannot prove that every expression will resolve against future Claim or Agreement data. A mapping failure for one source snapshot must therefore leave catalogue readiness unchanged and follow normal retry, dead-letter and Admin redrive handling.

## Payment Hub Identity and Request Shape

Payment Hub identity is owned entirely by Payments. Claims and Agreements do not store or allocate `claimId`, `paymentHubClaimId`, `paymentRequestNumber` or `invoiceNumber` merely because the legacy Agreements implementation did so.

The legacy Agreements acceptance path publishes one Payment Hub event. It maps every entry in the Agreement payment schedule into the event's `payments` array and sets `paymentRequestNumber` to 1. Those entries are scheduled payments within one request, not separate Payment Hub requests.

GAS preserves the following payload shape, subject to the compatibility gates below:

- each logical source request creates one Payment Hub event;
- Payments allocates one globally unique `claimId` in the `R########` format;
- `paymentRequestNumber` is 1;
- `invoiceNumber` uses the existing `R########-V001QX` format;
- all scheduled payments are carried in the event's `payments` array.

Request idempotency identifies that logical request:

- Agreement request: `agreementNumber + resulting agreementVersion`. The current Agreement runtime permits at most one Payment per action/version.
- Claim request: `code + clientRef + clientClaimRef`.

Before allocating a `claimId`, the handler checks for an existing Payment using the request key. The Payment, claim-ID allocation and external event are committed in one transaction. If the transaction aborts, the counter increment aborts with it. Redelivery finds the existing Payment and does not allocate another identifier or record another external event.

The current globally unique `paymentHubClaimId` index remains valid because each logical request has its own `claimId`. The existing unique source-request indexes enforce idempotency.

Supporting a later adjustment or another distinct Payment Hub request for the same source is outside this decision. That capability would require an explicit stable request identity and a decision about `paymentRequestNumber`; redelivery must never be interpreted as a new request.

## Transaction and Delivery Semantics

The source state change and its Payment request event commit atomically in the source transaction.

The Payments handler transaction atomically records:

- the Payment Hub claim-ID allocation;
- the Payment;
- the external Payment Hub event.

Marking the incoming durable event complete is a separate write performed by the event processor after the handler returns. Processing is therefore at least once, not atomically completed with the Payments transaction. Correctness comes from request idempotency and the uniqueness constraints.

External publication retries independently from Payment creation. A publication retry does not invoke Payment creation again. A redelivered source event may invoke the handler again, but the handler finds the existing Payment and does not create a duplicate external event.

## Agreement Lifecycle and HTTP Interfaces

Both the legacy Agreements API and the pre-decision GAS implementation copied `claimId` into the accepted Agreement lifecycle event. Dedicated consumer research (18 September 2026), backed by the CDP tenant configuration, identified only two source-controlled subscribers to the Agreement-status topic: GAS and `farming-grants-agreements-pdf`. Source inspection confirmed GAS uses Agreement identity and status while the PDF service uses Agreement and document fields; neither reads or contracts `claimId`. The topic has no cross-account allow-list. Admin only labels the event type and can expose the stored payload generically. The legacy producer obtained the value from the Payment payload and forwarded it; Agreement behaviour did not use it. This is a source-evidence conclusion, not proof of the complete live AWS topology: manually created subscriptions and consumers outside the DEFRA GitHub organisation remain residual uncertainty, which is why the live subscription inventory must still be reconfirmed immediately before removing the field in any environment that still carries it (see Rollout Obligations).

The decision was therefore to keep `claimId` in the Payment Hub event only and remove it from the Agreement lifecycle event; that removal is implemented and the acceptance API contract no longer returns a Payment Hub identifier. This keeps the Payment Hub identifier inside Payments and avoids delaying the lifecycle event for a Payments-produced response. A future consumer requirement would be a new explicit interface decision, not a reason to reintroduce a direct Agreements-to-Payments import.

Agreement acceptance is the completed business action; Payment Service availability is not part of that decision. The endpoint returns its normal success response once one local transaction has persisted the accepted Agreement, the Agreement lifecycle event and the durable Payment request event. It does not wait for Payment processing, return a Payment Hub `claimId`, or roll the Agreement back when downstream publication or processing fails. Acceptance still fails when its own validation, concurrency check or local transaction fails, including failure to persist the durable request event. Payment failures are retried and ultimately surfaced through the outbox/DLQ operational path.

## Compatibility Evidence

A one-off local comparison ran the legacy mapper and SNS serializer against an Agreement with two scheduled payments and both parcel-level and Agreement-level invoice lines, then built and mapped the equivalent GAS Payment. After normalising only generated event IDs, event times and due-payment correlation IDs, the complete CloudEvent payloads were structurally identical. This historical comparison informed the decision; it is not a remaining live-cutover gate.

The initial transport comparison used the legacy Agreements API's `create_payment.fifo` topic and established that the Payment Service consumes the resulting CloudEvent on `gps__sqs__create_payment.fifo`. That assumption was superseded on 24 September 2026: CDP does not permit GAS to publish to a topic owned by another service. GAS publishes to its own `gas__sns__create_payment_fifo.fifo` topic instead. Merged CDP tenant configuration subscribes the existing Payment Service queue to it in dev, test, perf-test, ext-test and prod; the GAS-owned `gas__sns__agreement_status_updated_fifo.fifo` topic is likewise configured for the existing GAS and PDF queues. The legacy Agreements API topics and subscriptions remain in place for its own traffic. Local, Vitest and FloCi configuration already model this topology, and a retained integration smoke publishes through the runtime `src/common/sns-client.js` adapter to the GAS-owned Payment topic and checks the unchanged body on the existing FloCi queue. That smoke proves local topic wiring, not a complete Payment payload or an end-to-end comparison against the legacy fixture.

GAS retains per-source FIFO grouping. Payment Service does not read the SQS message-group or sequence attributes: its create handler inserts an independent grant-payment document, uniqueness is enforced by grant and due-payment correlation IDs, scheduled processing selects by due date and status and deliberately runs Payments in parallel, and cancellation arrives on a separate queue. There is no global arrival-order dependency. Agreement Number or Client Reference preserves ordering where records are related while allowing unrelated Payments to proceed independently.

GAS intentionally retains stable event-ID deduplication rather than legacy random deduplication. Every outbox event has a unique ID and retries reuse that ID, so distinct Payments remain distinct while repeated publication within the FIFO deduplication window is suppressed. Payment Service also enforces unique grant and due-payment correlation IDs and handles duplicate-key delivery. Stable deduplication is therefore a compatibility-safe reliability improvement, not a cutover blocker.

Agreement-originated Woodland Payments remain excluded, matching the legacy Agreements API's behaviour for Woodland acceptance; a Woodland Agreement definition has no Payment commit operation, and this does not affect the distinct Claim-originated Woodland Payment flow.

If a future scheme change requires another compatibility comparison, exercise the published event through the runtime serializer and SNS adapter rather than relying on a hand-authored fixture or mapper-only unit test.

## Rollout Obligations

These operational obligations remain open. They gate environment rollout; they do not reopen this architectural decision or turn the historical FPTT comparison into a live-cutover gate.

- Before each environment switches its `cdp-app-config` topic ARNs, verify the GAS-owned Agreement-status topic reaches both the GAS and PDF queues and the GAS-owned Payment topic reaches `gps__sqs__create_payment.fifo`.
- Plan controlled recovery of already-failed GAS outbox records that still target legacy-owned topic ARNs: an application configuration switch does not retarget a stored row, and redrive alone replays the old ARN.
- Immediately before removing the lifecycle `claimId` field in any environment still carrying it, reconfirm the live subscription inventory for the GAS-owned Agreement-status topic matches only the GAS and PDF queues; investigate any unexpected subscriber before proceeding.

## Implementation Evidence

Claims and Agreements now commit producer-owned requests to the explicit `internal:event` target; commands retain the established `internal:message-bus` stored target for rolling-deploy compatibility. Exact-type dispatch rejects unknown event types into the existing retry, dead-letter and Admin redrive lifecycle.

The clean cutover removed all direct Payment creation and Claim resolver use cases, removed every Agreements/Grants-to-Payments ESLint exception, moved Agreement endpoint adapters into Agreements, and moved the shared mapping compiler to `common/mapping`. Config validation uses a context-neutral registration seam rather than a Grants import of Payments. The QA adapter is restricted to `agreements/testing.js`.

Verification includes repository-wide lint, the full unit test suite, focused real Mongo replica-set source and handler tests, runtime SNS delivery to the GPS queue, and compatibility coverage for multi-schedule Agreement Payments and the retained complete legacy event fixture. Grant Admin mapping and redrive tests show the original payload, target, last error and attempt history remain available for safe retry.

Agreement redelivery now checks for an existing Payment before resolving the pinned Payment definition, matching the Claim handler and this record's own stated invariant that redelivery finds the existing Payment even when the definition is no longer available (see Payment Hub Identity and Request Shape). A real Mongo replica-set regression proves one Payment, one counter increment and one external publication survive redelivery against an unavailable definition.

The remaining deployment work is limited to the Rollout Obligations above and does not reopen this architectural decision.

## Consequences

Claims and Agreements no longer import or coordinate Payments internals.

Payments owns its runtime, transactions, identifiers, persistence and external Payment Hub events.

Source operations become fail-open for data-dependent Payment mapping errors after configuration-time validation. Operations staff need clear failed-event diagnostics and a reliable Admin redrive path.

At-least-once delivery is explicit. Every Payment handler and identifier allocator must remain safe under concurrent delivery, transaction retry and manual redrive. The synchronous and event-driven creation paths must never create a Payment for the same source request concurrently.

One Payment Hub event can carry multiple scheduled payments in its `payments` array. This decision does not introduce multiple numbered Payment Hub requests for one Agreement or Claim.

The legacy Agreements service remains useful as evidence for the external Payment Hub event shape, but its internal identifier storage and synchronous publication flow are not copied into GAS.

This record defines the intended architecture and its implementation. Live legacy traffic migration still depends on the Rollout Obligations above.
