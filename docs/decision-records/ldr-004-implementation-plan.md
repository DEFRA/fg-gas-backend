# LDR-004 Implementation Plan

Status: active

Decision: [Event-driven Payment Creation in GAS](./ldr-004-event-driven-payment-creation.md)

## Resume Here

Read the decision record, then resume at the first unchecked item in the numbered work packages, following their stage order. Update the checkboxes and the checkpoint in the same change that completes a work package. The checkpoint also records compatibility and deployment gates that deliberately remain open until work packages 7 and 8; it is not the execution order. This is the single delivery checklist; design rationale remains in the decision record.

Current checkpoint, 18 September 2026:

- [x] Record the architecture decision and consumer research.
- [ ] Retain executable proof that the GAS Payment event matches the legacy runtime-serialized event after normalising generated identifiers and times. The completed one-off comparison informed the design but is not repeatable evidence.
- [x] Align local, Vitest and FloCi configuration to `create_payment.fifo` and `gps__sqs__create_payment.fifo`.
- [ ] Retain a repeatable runtime SNS-adapter smoke that receives the unchanged body from the FloCi Payment queue. The completed one-off smoke informed the design but is not retained proof.
- [x] Treat the externally managed CDP tenant publish permission as provisioned.
- [ ] Approve LDR-004 and change its status from `proposed` to `accepted`.

The code is not yet event-driven. Agreement acceptance and Claim submission still import Payments use-cases, resolve Payment definitions before their source transactions, allocate Payment Hub identifiers inside those transactions and persist Payment Service publications in the source-owned outbox work.

## Target Invariants

Every work package must preserve these invariants:

1. Agreement acceptance atomically persists the accepted Agreement, Agreement Version, lifecycle publications and durable `AgreementPaymentRequested` event.
2. Claim submission atomically persists the Claim and durable `ClaimPaymentRequested` event when that Claim should request a Payment.
3. A committed source operation never depends on Payments runtime availability and is never rolled back by later Payment mapping or publication failure.
4. Agreements and Grants import no Payments models, repositories, services or use-cases.
5. Payments owns definition resolution, Payment Hub identity allocation, Payment persistence and the external Payment Service event.
6. Processing either request event is idempotent under redelivery, concurrent delivery, MongoDB transaction retry and manual redrive.
7. One logical source request creates one Payment Service event. `paymentRequestNumber` remains `1`; scheduled payments remain entries in `payments[]`.
8. `claimId` remains in the Payment Service event and is absent from the Agreement lifecycle event and Agreement action response.
9. The direct and event-driven creation paths never create Payments concurrently for the same producer. A shadow path may validate only; it must not persist or publish.
10. Existing MongoDB collection names, Admin event inspection and redrive behaviour remain compatible while event infrastructure moves.

## FGP-1397 Composition

This preparatory refactor was identified while designing FGP-1397, but it does not deliver that ticket's conditional Application transition. Implement FGP-1397 after the refactor through `Application.moveTo` and a shared `transitionApplicationUseCase`.

The Claim submission transaction is the composition seam. Once all entitlements are satisfied, it must atomically persist the Claim, any Application position change, the Caseworking status command and configured transition processes, and any applicable durable `ClaimPaymentRequested` event. The later Payments handler remains post-commit and cannot roll back the Claim or Application transition.

## Local Stage Protocol

Implement each stage on its own branch. Every branch must preserve current behaviour or complete one producer cutover; do not push an intermediate state in which the application only compiles or both creation paths can write.

| Stage | Local change                                                                                                    | Safe intermediate state                                                                        | Required local proof                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Preserve the current synchronous baseline, align local transport and record the decision.                       | Current behaviour remains the comparison oracle.                                               | Focused Payment and Agreement tests pass.                                                                                          |
| 1     | Move the event stores, pollers, locking and Admin seams into `src/events/` without changing dispatch behaviour. | All existing messages still use the same collections and handlers.                             | Existing inbox, outbox, Admin and redrive tests pass; collection names are unchanged.                                              |
| 2     | Add exact typed event registration and the two producer-owned Payment request contracts.                        | Existing commands and events still work; no producer emits a Payment request yet.              | Registration, unknown-type, duplicate-registration and contract tests pass.                                                        |
| 3     | Extend the existing configuration-readiness gate for exact pinned-version event handling.                       | Direct Payment creation still runs against definitions validated before the version is stored. | Invalid-definition, optional-definition, exact-version and runtime-mapping-failure scenarios pass.                                 |
| 4     | Add Payments handlers and Payments-owned idempotent transactions.                                               | Handlers can be exercised directly, but production source paths still emit no request events.  | Direct handler, redelivery, concurrency, transaction-retry and publication-isolation scenarios pass.                               |
| 5     | Cut Claim submission from direct creation to `ClaimPaymentRequested` in one change.                             | Agreements remain synchronous; Claims have exactly one active creation path.                   | Claim submission, replay, approval-required, missing-definition and downstream-failure scenarios pass.                             |
| 6     | Cut Agreement acceptance from direct creation to `AgreementPaymentRequested` in one change.                     | Both producers now use events, with no direct creation path left.                              | Acceptance atomicity, downstream independence, lifecycle contract, Woodland exclusion and complete local transport scenarios pass. |
| 7     | Remove obsolete seams and tighten ESLint and documentation.                                                     | The event-driven design is the only implementation.                                            | Repository-wide lint and tests pass with no producer-to-Payments exceptions.                                                       |
| 8     | Satisfy deployment-only gates.                                                                                  | The locally proven implementation is eligible for environment rollout.                         | Live subscription inventory, CDP permission and scheme-by-scheme compatibility evidence are recorded.                              |

Use this branch-per-stage workflow:

1. Complete and verify one stage locally.
2. Push only that stage's branch and merge its PR.
3. Refresh the local base from the merged target branch.
4. Create the next stage branch from that refreshed base.

This keeps every PR small and prevents later-stage changes appearing in an earlier review. Do not open several dependent PRs against the target branch: until their predecessors merge, GitHub will show the earlier stages in every later diff. If work must continue while a PR is awaiting review, a later branch may temporarily start from the preceding local branch, but it must be rebased onto the merged target and fully reverified before it is pushed.

No runtime feature flag is required for this sequential workflow. If stages must instead be deployed independently, use one mutually exclusive mode (`direct` or `event`) per producer, default it to the currently proven path, and remove it after cutover. Never use independent booleans that can enable both paths.

The live subscription inventory is a deployment gate, not a blocker to implementing and testing lifecycle `claimId` removal locally. Update this plan after every stage so a later session resumes at the first unchecked item.

## Work Packages

### 1. Deepen the shared events module

- [x] Move the durable event models, repositories, FIFO locking and pollers from `src/grants/` into `src/events/`. Move `src/common/save-outbox-events.js` behind the same module interface.
- [x] Preserve the existing `inbox`, `outbox` and FIFO-lock collection identities and document shapes; this move must not require data migration or break old rows.
- [ ] Give `src/events/` a small interface for saving durable events, registering typed handlers and dispatching an event. Keep persistence, locking, retry, dead-letter and completion bookkeeping behind that interface.
- [ ] Keep the command bus for commands. Route internally delivered domain events through the event handler registry, including the existing Agreement-status handler.
- [x] Register the shared pollers once at application startup rather than from the Grants plugin. Ensure all context handlers are registered before polling starts.
- [x] Update Grant Admin to use the shared event repositories without changing list, detail, facet, failure-history or redrive behaviour.
- [x] Migrate `src/common/write-audit-event.js` and every other event-store caller to the shared events interface so `src/common/` no longer imports Grants event models or repositories.
- [x] Update `eslint.config.js` so every context may enter the events module while `src/events/` may import only common infrastructure. Once the legacy event imports are gone, forbid `src/common/` from importing any context module.
- [x] Add a canonical cross-module event section to `docs/MODULE_BOUNDARIES.md`: event versus command selection, producer contract ownership, exact type registration, transactional event persistence, post-commit handling, immutable snapshots, idempotency, ordering, retries/dead-letter/redrive, fan-out semantics and required verification.

Completion criterion: existing inbound and outbound event integration tests, Admin event tests and redrive tests pass against the same collections, and no event-store implementation remains under `src/grants/` or `src/common/`.

### 2. Freeze producer-owned request contracts

- [ ] Add `AgreementPaymentRequested` under `src/agreements/events/` and `ClaimPaymentRequested` under `src/grants/events/`. Define each CloudEvent type once and register handlers against the exact type rather than suffix or substring matching.
- [ ] Give every request a generated event ID plus a stable logical request identity. Agreement identity is `agreementNumber + resulting agreementVersion`; Claim identity is `code + clientRef + clientClaimRef`.
- [ ] Include the immutable source snapshot required by Payment mapping, the source identity, pinned configuration version and original source execution time. Do not make the handler reload mutable source records.
- [ ] Include the Agreement reference needed by a Claim Payment: Agreement Number, Agreement Version and correlation ID at submission time.
- [ ] Validate each request at its producer interface so malformed events cannot be committed.
- [ ] Specify a stable FIFO segregation reference: Agreement Number for Agreement requests and Client Reference for Claim requests.

Completion criterion: contract tests construct each request from source-owned values and prove the event contains everything Payments needs without importing either producer.

### 3. Extend configuration readiness for pinned events

- [ ] Preserve the existing pre-upsert whole-version gate: `validateConfigDefinitions` fetches and compiles every declared Grant, Agreement and Payment definition before the version is recorded; an absent optional `payment.json` remains a valid no-op.
- [ ] Reuse the existing Payment definition model for schema and JSONata compilation. Do not introduce a second readiness mechanism or write fetch status during the pre-upsert validation check.
- [ ] Load each Payment request's definition by its exact pinned configuration version. Exact event handling must never silently switch to a fallback version.
- [ ] Keep genuine definition fetch, schema and expression compilation failures classified as configuration failures with actionable diagnostics.
- [ ] Treat mapping evaluation against a particular Agreement or Claim snapshot as an event-processing failure. It must retry or dead-letter that request without marking the shared definition or configuration version unusable.
- [ ] Preserve fallback semantics only for existing callers that deliberately select a compatible version.

Completion criterion: an invalid declared Payment definition prevents the configuration version being recorded, an absent optional Payment definition does not, and a data-dependent mapping failure leaves catalogue readiness unchanged while the event reaches retry/dead-letter handling.

### 4. Add Payments-owned event handling

- [ ] Add a Payments plugin and register it in `src/main.js`. The plugin registers handlers for both producer event types and owns no producer imports.
- [ ] Map each immutable request snapshot through its exact pinned Payment definition inside the Payments handler.
- [ ] Add repository lookup by logical request identity using the existing Agreement and Claim unique source indexes.
- [ ] In a Payments-owned MongoDB transaction, find an existing Payment before allocation. If absent, allocate the next `R########` claim ID, build and insert the Payment, and persist its external Payment Service publication.
- [ ] Make source-index duplicate races idempotent: abort the losing transaction, reload the existing Payment and complete without another counter value or publication.
- [ ] Commit the Payment, counter increment and external publication atomically. Mark the incoming durable request complete only after the handler returns; completion remains a separate at-least-once write.
- [ ] Preserve stable SNS deduplication using the persisted external event ID and preserve the per-source FIFO grouping already implemented.
- [ ] Keep external publication retry independent from Payment creation. Retrying a failed SNS publication must not invoke the Payment request handler again.

Completion criterion: sequential redelivery, concurrent delivery, transaction retry and manual redrive of one logical request leave exactly one Payment, one committed claim-ID increment and one external Payment event.

### 5. Cut Claim submission over

- [ ] Replace `resolveClaimPayment` and `createClaimPaymentUseCase` calls in `src/grants/services/claims.service.js` with a producer-owned `ClaimPaymentRequested` event for an eligible auto-paying Claim.
- [ ] Persist the Claim and Payment request in the same Claim submission transaction. Preserve replay, application-version retry and capacity checks.
- [ ] Carry the pinned configuration version and point-in-time Agreement reference in the request; the Payments handler must not reload the current Agreement.
- [ ] Preserve the existing no-Payment behaviour for Claims requiring approval and configurations without an optional Payment definition.
- [ ] Preserve the Claim submission HTTP `claimId`: it is the GAS Claim document identifier, not the Payment Hub `claimId` covered by LDR-004.

Completion criterion: a replayed Claim submission returns the existing Claim and cannot create another request or Payment; a later Payment failure does not roll back the committed Claim.

### 6. Close Agreement compatibility gates and cut acceptance over last

Prerequisite: work packages 1–5 are complete.

- [ ] For every migrated Agreement scheme, compare its Payment definition with the legacy constants and mappings. For FPTT this includes `scheme: SFI`, `sourceSystem: FPTT`, `deliveryBody: RP00`, `fesCode: FALS_FPTT`, `ledger: AP`, `accountCode: SOS710`, `fundCode: DRD10`, marketing year, descriptions, dates and stringified money.
- [ ] Prove one Agreement with multiple scheduled payments produces one Payment Service event with all entries in `payments[]`, `paymentRequestNumber: 1` and the expected invoice-number format.
- [ ] Prove the complete runtime-serialized CloudEvent matches the captured legacy fixture except for generated IDs and times.
- [ ] Exercise the complete local path: source transaction → durable request → Payments handler transaction → external outbox → runtime SNS adapter → `gps__sqs__create_payment.fifo`.
- [ ] Replace pre-transaction Payment definition resolution and direct Payment creation in `execute-agreement-action.use-case.js` with construction of `AgreementPaymentRequested` from the resulting Agreement and action execution snapshot.
- [ ] In the existing Agreement transaction, persist the current Agreement, Agreement Version, lifecycle publications, reporting publication and Payment request event together.
- [ ] Remove `claimId` and every Payment parameter from `create-outbox-messages.js`; lifecycle publication must depend only on Agreement-owned data.
- [ ] Preserve the normal `303` Agreement action response. It returns no Payment Hub identifier and does not wait for Payment handling.
- [ ] Preserve Agreement validation, optimistic concurrency and idempotency behaviour. Failure to persist the durable request rolls back acceptance; later Payment processing failure does not.
- [ ] Apply the same cutover through `commitAgreementAction` so HTTP actions and internal Agreement-status commands cannot diverge.
- [ ] Keep Agreement-originated Woodland Payments excluded. A Woodland definition must not gain a Payment commit operation as part of this work, while Claim-originated Woodland behaviour remains intact.

Completion criterion: the executable compatibility gates pass; acceptance succeeds with Payments processing unavailable; the accepted Agreement and durable request are committed; the lifecycle event and HTTP contract have no Payment Hub `claimId`; and a local transaction failure leaves none of those writes committed.

### 7. Clean cutover

- [ ] Remove obsolete direct creation use-cases, pre-transaction resolvers, caller-owned Payment transaction coordination and tests that describe the old synchronous contract.
- [ ] Remove the Payments import exceptions for Agreements and Grants from `eslint.config.js`; lint must enforce the event seam in both directions.
- [ ] Move Agreement-only endpoint helpers from `src/common/agreements/` into Agreements. Move the mapping compiler used by both Agreements and Payments to a context-neutral shared mapping module; Payments must not depend on an Agreement-named shared path.
- [ ] Add an ESLint zone that limits `test-endpoints` to its documented Agreements entry points, matching the enforcement already applied to Grant Admin.
- [ ] Rewrite the Payment section of `docs/MODULE_BOUNDARIES.md` around producer events and the Payments handler interface.
- [ ] Confirm Admin exposes mapping and publication failures with enough detail to redrive the durable event safely.
- [ ] Remove obsolete aliases, exports, comments, fixtures and mocks. Keep the legacy event fixture as the repeatable compatibility oracle.
- [ ] Update LDR-004 with final implementation evidence and change its status to the repository's completed/accepted convention.

Completion criterion: no production import crosses from Agreements or Grants into Payments, no direct creation path remains, `src/common/` imports no context module or Agreement-owned implementation, Admin can redrive failures safely, and repository-wide lint and tests pass.

### 8. Satisfy deployment-only gates

- [ ] Immediately before deploying lifecycle `claimId` removal, compare the live SNS subscription inventory with the two source-controlled Agreement-status subscriptions. Resolve any unexpected subscriber before rollout.
- [ ] Confirm the externally managed CDP tenant publish permission remains provisioned.
- [ ] Record the approved definition-specific compatibility evidence for every scheme enabled in the rollout.

Completion criterion: the live inventory and permission match the source-controlled design, every enabled scheme has recorded compatibility evidence, and the implementation is eligible for environment rollout.

## Required Verification Matrix

| Behaviour               | Required proof                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Source atomicity        | Force durable request persistence to fail; source state, version/lifecycle or Claim all roll back.                                   |
| Downstream independence | Commit the source while Payments handling fails; source remains committed and event becomes retryable/dead-lettered.                 |
| Idempotency             | Deliver the same request sequentially and concurrently; one Payment, claim ID and external event exist.                              |
| Publication isolation   | Fail SNS publication and retry it; Payment creation is not re-entered.                                                               |
| Configuration readiness | Invalid declared definition is unusable; missing optional definition is usable; runtime data failure does not poison the definition. |
| Agreement compatibility | `303` response remains stable and lifecycle data has no Payment Hub `claimId`.                                                       |
| Payment compatibility   | Complete CloudEvent matches the legacy fixture and one request contains all scheduled payments.                                      |
| Woodland exclusion      | Agreement acceptance raises no Woodland Payment request; Claim-originated Woodland coverage still passes.                            |
| Operational recovery    | Admin shows the failed request and a redrive completes without duplication.                                                          |
| Module independence     | ESLint passes with no producer-to-Payments exceptions.                                                                               |
| Runtime transport       | Local end-to-end message arrives on `gps__sqs__create_payment.fifo`.                                                                 |

Use the narrowest focused tests while implementing each package. Before cutover, run `npm run lint`, `npm test`, the end-to-end local transport scenario and the definition-specific compatibility comparisons.

## External Dependency

The CDP application configuration already points at `create_payment.fifo`. The team-owned CDP tenant permission change is outside this repository and is treated as complete, as agreed on 18 September 2026. Do not create a replacement topic or subscription.

## Non-goals

- Multiple numbered Payment Hub requests or adjustments for one source.
- A pending Agreement or Claim workflow waiting for Payment completion.
- Recreating legacy Agreements API internal identifier storage.
- Agreement-originated Woodland Payment enablement.
- Dual-writing Payments from both the direct and event-driven paths.
