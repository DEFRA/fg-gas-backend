# Lightweight Decision Record - Event-driven Payment Creation in GAS

|                  |                  |
| ---------------- | ---------------- |
| status           | proposed         |
| date             | 18 Sep 2026      |
| decision makers  | Core Grants Team |
| people consulted | Martin Smith     |
| people informed  | Core Grants Team |

Implementation and resume checklist: [LDR-004 implementation plan](./ldr-004-implementation-plan.md).

## Context and Problem Statement

Claims and Agreements currently call Payments use-cases directly. The caller resolves the Payment definition before starting its transaction, then passes the transaction session into Payments so the source record, Payment, Payment Hub event and durable event records commit or roll back together.

This preserves synchronous failure behaviour, but it makes Claims and Agreements depend on Payments internals and gives the source modules responsibility for coordinating Payment persistence and publication. It also leaves the durable event infrastructure inside Grants even though Agreements, Payments and other modules need the same capability.

GAS must match the external Payment Hub event payload and transport interface. It does not need to reproduce the internal data model or allocation timing of the legacy Farming Agreements API. Compatibility with the legacy Agreement HTTP response and Agreement lifecycle event is a separate cutover obligation; this decision must not be read as evidence that those interfaces can change.

We need to decide how Claims and Agreements request Payments without importing Payments code, how Payment definition failures are handled, and how Payment Hub identifiers are allocated without producing duplicates under at-least-once delivery.

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

Payment definitions that are present are schema-validated and their JSONata expressions are compiled when configuration is ingested. A missing optional `payment.json` is a valid no-op. A configuration version that declares a Payment definition is not usable until that definition passes validation.

This is a new readiness capability. The current configuration catalogue tracks definition types independently and has no whole-version readiness gate. The implementation must add an explicit shared readiness rule rather than assume one already exists.

Ingestion-time validation can prove the definition's structure and expression syntax. It cannot prove that every expression will resolve against future Claim or Agreement data. A data-dependent runtime failure therefore occurs after the source transaction has committed; it follows normal retry, dead-letter and Admin redrive handling.

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

Both the legacy Agreements API and current GAS implementation copy `claimId` into the accepted Agreement lifecycle event. The [supporting DEFRA repository research](./ldr-004-claim-id-consumer-research.md) and the CDP tenant configuration identify only two subscribers to the Agreement-status topic: GAS and `farming-grants-agreements-pdf`. GAS uses Agreement identity and status; the PDF service uses Agreement and document fields. Neither reads or contracts `claimId`, and the topic has no cross-account allow-list. Agreement UI and Caseworking do not reference the field, while Admin only labels the event type. The legacy producer obtains the value from the Payment payload and forwards it; Agreement behaviour does not use it.

The decision is therefore to keep `claimId` in the Payment Hub event only and remove it from the Agreement lifecycle event. This keeps the Payment Hub identifier inside Payments and avoids delaying the lifecycle event for a Payments-produced response. A future consumer requirement would be a new explicit interface decision, not a reason to reintroduce a direct Agreements-to-Payments import.

Agreement acceptance is the completed business action; Payment Service availability is not part of that decision. The endpoint returns its normal success response once one local transaction has persisted the accepted Agreement, the Agreement lifecycle event and the durable Payment command. It does not wait for Payment processing, return a Payment Hub `claimId`, or roll the Agreement back when downstream publication or processing fails. Acceptance still fails when its own validation, concurrency check or local transaction fails, including failure to persist the durable command. Payment failures are retried and ultimately surfaced through the outbox/DLQ operational path.

## Compatibility and Cutover Gates

A one-off local executable comparison ran the legacy mapper and SNS serializer against an Agreement with two scheduled payments and both parcel-level and Agreement-level invoice lines, then built and mapped the equivalent GAS Payment. After normalising only generated event IDs, event times and due-payment correlation IDs, the complete CloudEvent payloads were structurally identical. This closes the payload-shape question; the throwaway comparison code was removed after execution.

The prior topic difference was a source-tree configuration inconsistency, not a deployed topic change. GAS's local environment, Vitest configuration and FloCi wiring now use the Payment Service's existing `create_payment.fifo` topic, matching CDP application configuration in every environment. FloCi subscribes the production-named `gps__sqs__create_payment.fifo` queue. The required CDP tenant publish permission is managed externally and treated as provisioned for this decision.

GAS retains per-source FIFO grouping. Payment Service does not read the SQS message-group or sequence attributes: its create handler inserts an independent grant-payment document, uniqueness is enforced by grant and due-payment correlation IDs, scheduled processing selects by due date and status and deliberately runs Payments in parallel, and cancellation arrives on a separate queue. There is no global arrival-order dependency. Agreement Number or Client Reference preserves ordering where records are related while allowing unrelated Payments to proceed independently.

GAS intentionally retains stable event-ID deduplication rather than legacy random deduplication. Every outbox event has a unique ID and retries reuse that ID, so distinct Payments remain distinct while repeated publication within the FIFO deduplication window is suppressed. Payment Service also enforces unique grant and due-payment correlation IDs and handles duplicate-key delivery. Stable deduplication is therefore a compatibility-safe reliability improvement, not a cutover blocker.

Payment cutover remains blocked until all of the following are satisfied:

- Every Payment definition used for a migrated scheme is checked against the legacy constants and mappings. For the FPTT interface this includes `scheme: SFI`, `sourceSystem: FPTT`, `deliveryBody: RP00`, `fesCode: FALS_FPTT`, `ledger: AP`, invoice-line `accountCode: SOS710`, `fundCode: DRD10`, invoice-line `deliveryBody: RP00`, marketing-year derivation, descriptions, dates and stringified monetary values. Configurability must not silently change the contract.
- Local, test and FloCi topic configuration remains aligned with the CDP application configuration for `create_payment.fifo`. The comparison confirmed that CloudEvent `source`, `type`, `specversion` and `datacontenttype` match.
- Agreement-originated Woodland Payments remain excluded. The legacy Agreements API deliberately does not publish a Payment event for Woodland acceptance; a Woodland Agreement definition must not introduce a Payment commit operation without a separate migration decision. This does not affect the distinct Claim-originated Woodland Payment flow.
- Immediately before removing lifecycle `claimId`, the live SNS subscription inventory matches the two source-controlled subscriptions. This detects configuration drift or manually created subscribers; it does not require consumer sign-off when the inventory matches.
- The acceptance API contract and client tests reflect a successful accepted Agreement without `claimId`; downstream Payment failure is covered by retry/DLQ operations rather than HTTP failure or Agreement rollback.

The compatibility proof must exercise the published event through the same serializer and SNS adapter used at runtime. A hand-authored fixture or a mapper-only unit test is not sufficient evidence of transport compatibility.

A local transport smoke published through the runtime `src/common/sns-client.js` adapter to Floci's `create_payment.fifo` topic and received the unchanged message body from `gps__sqs__create_payment.fifo`.

## Migration

The migration is staged:

1. Move the durable event infrastructure into `src/events/` without changing behaviour or MongoDB collection identities.
2. Add event-type dispatch while retaining the existing Grants handler.
3. Add the Payments plugin, handlers, identifier allocation and idempotency.
4. Add ingestion-time Payment definition validation and the explicit configuration-readiness rule.
5. Complete the Payment payload, configuration, transport, Woodland, lifecycle and HTTP compatibility gates.
6. Cut Claims over to `ClaimPaymentRequested`.
7. Cut Agreements over to `AgreementPaymentRequested` only after its legacy-facing compatibility gates pass.
8. Remove the direct Payments calls, obsolete transaction coordination, lint exceptions and outdated module-boundary documentation.

The synchronous and asynchronous creation paths must never create Payments for the same source request at the same time. A temporary shadow event path may observe and validate events, but it must not persist Payments or publish Payment Hub events.

## Consequences

Claims and Agreements no longer import or coordinate Payments internals.

Payments owns its runtime, transactions, identifiers, persistence and external Payment Hub events.

Source operations become fail-open for data-dependent Payment mapping errors after configuration-time validation. Operations staff need clear failed-event diagnostics and a reliable Admin redrive path.

At-least-once delivery is explicit. Every Payment handler and identifier allocator must remain safe under concurrent delivery, transaction retry and manual redrive.

One Payment Hub event can carry multiple scheduled payments in its `payments` array. This decision does not introduce multiple numbered Payment Hub requests for one Agreement or Claim.

The legacy Agreements service remains useful as evidence for the external Payment Hub event shape, but its internal identifier storage and synchronous publication flow are not copied into GAS.

This record defines the intended architecture but does not by itself prove legacy compatibility. Cutover evidence is required before live legacy traffic moves.
