# LDR-004 Implementation Plan

Status: active

Decision: [Event-driven Payment Creation in GAS](./ldr-004-event-driven-payment-creation.md)

## Resume Here

Read the decision record, then resume at the first unchecked item in the numbered work packages, following their stage order. Update the checkboxes and the checkpoint in the same change that completes a work package. The checkpoint also records compatibility and deployment gates that deliberately remain open until work packages 7 and 8; it is not the execution order. This is the single delivery checklist; design rationale remains in the decision record.

Current checkpoint, 25 September 2026:

- [x] Record the architecture decision and consumer research.
- [x] Retain the captured legacy FPTT event as historical serializer regression evidence. FPTT is closed and is not a migrated Agreement scheme, so its source-specific mapping is not a cutover gate; live migrated schemes require definition-specific compatibility evidence.
- [x] Align local, Vitest and FloCi configuration to GAS-owned `gas__sns__create_payment_fifo.fifo` and `gas__sns__agreement_status_updated_fifo.fifo`, with the existing Payment, GAS and PDF queues.
- [x] Retain a repeatable runtime SNS-adapter smoke that receives the unchanged body from the existing FloCi Payment queue via the GAS-owned topic. This proves transport wiring, not full Payment payload compatibility or the source-to-handler end-to-end path.
- [x] Merge the CDP tenant configuration for GAS-owned topics and subscriptions in dev, test, perf-test, ext-test and prod, including the Payment Service queue subscription. Verify live delivery before each environment's GAS application ARN switch; CDP does not support publishing to another service's topic.
- [x] Move durable event infrastructure into `src/events/` and replace source-keyed dispatch with exact CloudEvent type registration.
- [x] Freeze producer-owned `AgreementPaymentRequested` and `ClaimPaymentRequested` contracts without emitting them from production paths.
- [x] Preserve the whole-version readiness gate and exact Payment definition loading; classify source-data mapping failures as retryable request failures without poisoning configuration readiness.
- [x] Add the Agreement and Claim Payments handlers (#688 and #700): both register by producer event type, map pinned snapshots, look up logical source identity before allocating, and commit Payment, claim-ID increment and external publication together. Claim source-index duplicate recovery reloads the committed winner; handler and Inbox tests cover redelivery, concurrency, transaction retry and retryable bad snapshots.
- [x] Classify irrecoverable pinned Payment definition failures as non-retryable for both handlers; keep transient loading and source-data mapping failures retryable, with Inbox and handler proof.
- [x] Finish work package 4: a failed SNS publication retries the same persisted event ID without re-entering Payment creation; manual Inbox redrive after Payment commit completes both Claim and Agreement requests without another Payment, claim-ID increment or publication.
- [x] Finish work package 5: Claim submission now writes a pinned `ClaimPaymentRequested` alongside the Claim, without creating a Payment synchronously. Mongo replica-set tests prove replay, missing optional definition, source-transaction rollback when request persistence fails, subsequent Payment creation and independence from a failed Payment handler; the existing Claim service and HTTP route tests preserve capacity, version retry and response behaviour. Full unit suite (3,019 tests), focused container-backed Claim inbox tests (8) and lint pass.
- [x] Finish work package 6: Agreement actions and internal status commands commit a pinned `AgreementPaymentRequested` instead of resolving or creating Payments synchronously. Focused tests prove atomicity, replay and concurrency, downstream independence, Woodland exclusion, two scheduled payments in one request, lifecycle removal of `claimId`, and source-to-SNS-to-GPS delivery for the migrated `pigs-might-fly` scheme. The historical FPTT event remains a serializer regression but FPTT is closed and is not a migrated cutover scheme. Full unit suite (3,004 tests), focused container-backed Agreement and transport tests (22) and lint pass. A full integration run still fails on baseline Client request timeouts, reproduced on the parent branch for Agreement test endpoints; it is not a full pass.
- [x] Finish work package 7: remove the obsolete synchronous Payment seams, enforce module boundaries, introduce explicit event and command routing, and record the clean-cutover verification evidence. Repository-wide lint and all 2,995 unit tests pass; the focused source and handler integration suites pass 61 tests.
- [x] Approve LDR-004 and change its status from `proposed` to `accepted`.

Work packages 1–7 are complete. Work package 8's deployment-only gates are next.

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

Implement each stage on its own branch, stacked on its immediate predecessor while that PR is open. Every branch must preserve current behaviour or complete one producer cutover; do not push an intermediate state in which the application only compiles or both creation paths can write.

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
| 8     | Satisfy deployment-only gates.                                                                                  | The locally proven implementation is eligible for environment rollout.                         | GAS-owned topic and subscription inventory, outbox recovery and scheme-by-scheme compatibility evidence are recorded.              |

Use this branch-per-stage stack:

1. Complete and verify each stage as a safe intermediate state. Base the next branch on the exact head of its predecessor; the Claim cutover starts from the Payments-handler branch (#700).
2. Open a child PR **against its predecessor branch**, never against `main` while that predecessor remains unmerged. Confirm the PR's three-dot diff contains only its own stage; a parent update must be merged into the child and reverified before review resumes.
3. Merge bottom-up. Prefer a merge commit for a parent with open children so its commits remain ancestors of the child; after it merges, retarget the immediate child PR to `main`, confirm its diff still contains only the child stage, and rerun checks before merging it. Repeat for each child.
4. If a parent is squash- or rebase-merged instead, do not retarget its child blindly: create a **new** branch from merged `main`, cherry-pick only the child's own commits, reverify, and open a replacement PR. Never force-push or silently rewrite a reviewed branch; keep the old PR for review provenance until its replacement is ready.

Wait for #700's head checks before opening its child PR (all were green on 25 September 2026). Keep deployment-only environment gates outside the code-PR stack. Do not merge a child while its parent is open or let a cutover branch enable both direct and event-driven Payment creation for the same producer.

No runtime feature flag is required for this sequential workflow. If stages must instead be deployed independently, use one mutually exclusive mode (`direct` or `event`) per producer, default it to the currently proven path, and remove it after cutover. Never use independent booleans that can enable both paths.

The live subscription inventory is a deployment gate, not a blocker to implementing and testing lifecycle `claimId` removal locally. Update this plan after every stage so a later session resumes at the first unchecked item.

## Work Packages

### 1. Deepen the shared events module

- [x] Move the durable event models, repositories, FIFO locking and pollers from `src/grants/` into `src/events/`. Move `src/common/save-outbox-events.js` behind the same module interface.
- [x] Preserve the existing `inbox`, `outbox` and FIFO-lock collection identities and document shapes; this move must not require data migration or break old rows.
- [x] Give `src/events/` a small interface for saving durable events, registering typed handlers and dispatching an event. Keep persistence, locking, retry, dead-letter and completion bookkeeping behind that interface.
- [x] Remove the Stage 1 source-keyed dispatcher. Retain `AS`, `CW` and `CB` only as persistence and administration metadata.
- [x] Keep the command bus for commands. Route internally delivered domain events through the event handler registry, including the existing Agreement-status handler.
- [x] Register the shared pollers once at application startup rather than from the Grants plugin. Ensure all context handlers are registered before polling starts.
- [x] Update Grant Admin to use the shared event repositories without changing list, detail, facet, failure-history or redrive behaviour.
- [x] Migrate `src/common/write-audit-event.js` and every other event-store caller to the shared events interface so `src/common/` no longer imports Grants event models or repositories.
- [x] Update `eslint.config.js` so every context may enter the events module while `src/events/` may import only common infrastructure. Once the legacy event imports are gone, forbid `src/common/` from importing any context module.
- [x] Add a canonical cross-module event section to `docs/MODULE_BOUNDARIES.md`: event versus command selection, producer contract ownership, exact type registration, transactional event persistence, post-commit handling, immutable snapshots, idempotency, ordering, retries/dead-letter/redrive, fan-out semantics and required verification.

Completion criterion: existing inbound and outbound event integration tests, Admin event tests and redrive tests pass against the same collections, and no event-store implementation remains under `src/grants/` or `src/common/`.

### 2. Freeze producer-owned request contracts

- [x] Add `AgreementPaymentRequested` under `src/agreements/events/` and `ClaimPaymentRequested` under `src/grants/events/`. Define each CloudEvent type once and register handlers against the exact type rather than suffix or substring matching.
- [x] Give every request a generated event ID plus a stable logical request identity. Agreement identity is `agreementNumber + resulting agreementVersion`; Claim identity is `code + clientRef + clientClaimRef`.
- [x] Include the immutable source snapshot required by Payment mapping, the source identity, pinned configuration version and original source execution time. Do not make the handler reload mutable source records.
- [x] Include the Agreement reference needed by a Claim Payment: Agreement Number, Agreement Version and correlation ID at submission time.
- [x] Validate each request at its producer interface so malformed events cannot be committed.
- [x] Specify a stable FIFO segregation reference: Agreement Number for Agreement requests and Client Reference for Claim requests.

Completion criterion: contract tests construct each request from source-owned values and prove the event contains everything Payments needs without importing either producer.

### 3. Extend configuration readiness for pinned events

- [x] Preserve the existing pre-upsert whole-version gate: `validateConfigDefinitions` fetches and compiles every declared Grant, Agreement and Payment definition before the version is recorded; an absent optional `payment.json` remains a valid no-op.
- [x] Reuse the existing Payment definition model for schema and JSONata compilation. Do not introduce a second readiness mechanism or write fetch status during the pre-upsert validation check.
- [x] Load each Payment request's definition by its exact pinned configuration version. Exact event handling must never silently switch to a fallback version.
- [x] Keep genuine definition fetch, schema and expression compilation failures classified as configuration failures with actionable diagnostics.
- [x] Treat mapping evaluation against a particular Agreement or Claim snapshot as a retryable request-processing failure without marking the shared definition or configuration version unusable. Prove durable retry/dead-letter delivery when the Payments handler exists in work package 4.
- N/A for Payments: definition loading always uses the exact pinned version; there is no Payment fallback path to preserve.

Readiness checks definition shape and expression syntax, not resolved Payment totals. Even constant mappings that can never balance may pass ingestion and fail each request as retryable. This is a deliberate limit of the pre-upsert gate; work package 4 must make repeated failures visible for operational investigation and redrive rather than add a separate constant-only evaluation path.

Completion criterion: an invalid declared Payment definition prevents the configuration version being recorded, an absent optional Payment definition does not, and a data-dependent mapping failure leaves catalogue readiness unchanged while the request error remains retryable. Work package 4 verifies that the Inbox retries or dead-letters the durable request.

### 4. Add Payments-owned event handling

- [x] Add a Payments plugin and register it in `src/main.js`. The plugin registers handlers for both producer event types and owns no producer imports.
- [x] Map each immutable request snapshot through its exact pinned Payment definition inside the Payments handler.
- [x] Prove a failed snapshot mapping reaches Inbox retry/dead-letter handling without making that Payment definition unusable for another request.
- [x] Classify definition-loading failures that cannot recover on retry as permanent for the Inbox, while snapshot-mapping failures remain retryable; do not treat every Boom error as permanent.
- [x] Add repository lookup by logical request identity using the existing Agreement and Claim unique source indexes.
- [x] In a Payments-owned MongoDB transaction, find an existing Payment before allocation. If absent, allocate the next `R########` claim ID, build and insert the Payment, and persist its external Payment Service publication.
- [x] Make source-index duplicate races idempotent: abort the losing transaction, reload the existing Payment and complete without another counter value or publication.
- [x] Commit the Payment, counter increment and external publication atomically. Mark the incoming durable request complete only after the handler returns; completion remains a separate at-least-once write.
- [x] Preserve stable SNS deduplication using the persisted external event ID and preserve the per-source FIFO grouping already implemented.
- [x] Keep external publication retry independent from Payment creation. Retrying a failed SNS publication must not invoke the Payment request handler again.

Completion criterion: sequential redelivery, concurrent delivery, transaction retry and manual redrive of one logical request leave exactly one Payment, one committed claim-ID increment and one external Payment event.

### 5. Cut Claim submission over

- [x] Replace `resolveClaimPayment` and `createClaimPaymentUseCase` calls in `src/grants/services/claims.service.js` with a producer-owned `ClaimPaymentRequested` event for an eligible auto-paying Claim.
- [x] Persist the Claim and Payment request in the same Claim submission transaction. Preserve replay, application-version retry and capacity checks.
- [x] Carry the pinned configuration version and point-in-time Agreement reference in the request; the Payments handler must not reload the current Agreement.
- [x] Preserve the existing no-Payment behaviour for Claims requiring approval and configurations without an optional Payment definition.
- [x] Preserve the Claim submission HTTP `claimId`: it is the GAS Claim document identifier, not the Payment Hub `claimId` covered by LDR-004.

Completion criterion: a replayed Claim submission returns the existing Claim and cannot create another request or Payment; a later Payment failure does not roll back the committed Claim.

### 6. Close Agreement compatibility gates and cut acceptance over last

Prerequisite: work packages 1–5 are complete.

- [x] For every migrated Agreement scheme, compare its Payment definition with its supported interface. The migrated `pigs-might-fly` definition is exercised end to end for `scheme: SFI`, `sourceSystem: FPTT`, `deliveryBody: RP00`, `fesCode: FALS_FPTT`, `ledger: AP`, `accountCode: SOS710`, `fundCode: DRD10`, marketing year, descriptions, dates and stringified money. The closed FPTT grant is not in migration scope.
- [x] Prove one Agreement with multiple scheduled payments produces one Payment Service event with all entries in `payments[]`, `paymentRequestNumber: 1` and the expected invoice-number format.
- [x] Preserve the complete captured legacy FPTT CloudEvent as a serializer regression and prove the migrated `pigs-might-fly` event reaches the existing GPS queue unchanged through the runtime SNS adapter. Exact source-data parity with FPTT is not required because the grant is closed and is not migrated.
- [x] Exercise the complete local path: source transaction → durable request → Payments handler transaction → external outbox → runtime SNS adapter → `gps__sqs__create_payment.fifo`.
- [x] Replace pre-transaction Payment definition resolution and direct Payment creation in `execute-agreement-action.use-case.js` with construction of `AgreementPaymentRequested` from the resulting Agreement and action execution snapshot.
- [x] In the existing Agreement transaction, persist the current Agreement, Agreement Version, lifecycle publications, reporting publication and Payment request event together.
- [x] Remove `claimId` and every Payment parameter from `create-outbox-messages.js`; lifecycle publication must depend only on Agreement-owned data.
- [x] Preserve the normal `303` Agreement action response. It returns no Payment Hub identifier and does not wait for Payment handling.
- [x] Preserve Agreement validation, optimistic concurrency and idempotency behaviour. Failure to persist the durable request rolls back acceptance; later Payment processing failure does not.
- [x] Apply the same cutover through `commitAgreementAction` so HTTP actions and internal Agreement-status commands cannot diverge.
- [x] Keep Agreement-originated Woodland Payments excluded. A Woodland definition must not gain a Payment commit operation as part of this work, while Claim-originated Woodland behaviour remains intact.

Completion criterion: the executable compatibility gates pass; acceptance succeeds with Payments processing unavailable; the accepted Agreement and durable request are committed; the lifecycle event and HTTP contract have no Payment Hub `claimId`; and a local transaction failure leaves none of those writes committed.

### 7. Clean cutover

- [x] Remove obsolete direct creation use-cases, pre-transaction resolvers, caller-owned Payment transaction coordination and tests that describe the old synchronous contract.
- [x] Remove the Payments import exceptions for Agreements and Grants from `eslint.config.js`; lint must enforce the event seam in both directions.
- [x] Move Agreement-only endpoint helpers from `src/common/agreements/` into Agreements. Move the mapping compiler used by both Agreements and Payments to a context-neutral shared mapping module; Payments must not depend on an Agreement-named shared path.
- [x] Add an ESLint zone that limits `test-endpoints` to its documented Agreements entry points, matching the enforcement already applied to Grant Admin.
- [x] Rewrite the Payment section of `docs/MODULE_BOUNDARIES.md` around producer events and the Payments handler interface.
- [x] Confirm Admin exposes mapping and publication failures with enough detail to redrive the durable event safely.
- [x] Replace handler-presence routing for internal outbox delivery with explicit event and command targets. Keep commands on the command bus and dispatch events by exact type; unknown event types must fail through the event retry/dead-letter path rather than fall back to the command bus. Test known events, commands and unknown events.
- [x] Remove obsolete aliases, exports, comments, fixtures and mocks. Keep the legacy event fixture as the repeatable compatibility oracle.
- [x] Update LDR-004 with final implementation evidence and change its status to the repository's completed/accepted convention.

Completion criterion: no production import crosses from Agreements or Grants into Payments, no direct creation path remains, `src/common/` imports no context module or Agreement-owned implementation, Admin can redrive failures safely, and repository-wide lint and tests pass.

Evidence: explicit routing is covered for known events, commands and unknown
event types; the three focused source/handler integration files passed 61 tests;
all 2,995 unit tests and repository-wide lint passed. Admin's GAS redrive cases
passed and retain the original payload, target, failure and attempt history.
The broader Admin/Caseworking integration cases continue to hit the previously
reproduced `Client request timeout` baseline (five Caseworking redrive cases in
an isolated run).

### 8. Satisfy deployment-only gates

- [ ] Before switching the Agreement-status ARN in each environment, verify the merged GAS-owned FIFO topic subscription delivers to both existing GAS and PDF queues; leave the legacy topic subscriptions in place for legacy traffic.
- [ ] Before switching the Payment ARN in each environment, verify the merged GAS-owned FIFO topic subscription delivers to `gps__sqs__create_payment.fifo`. A publish with no working subscription can complete the outbox row without delivering a Payment.
- [ ] Plan controlled recovery of failed GAS outbox records targeting legacy-owned topics. Redrive alone retains the stored old ARN and cannot resolve the failure.
- [ ] Record the approved definition-specific compatibility evidence for every scheme enabled in the rollout.

Completion criterion: each per-environment `cdp-app-config` ARN switch follows verification of live delivery to its existing consumer queues, failed legacy-target outbox rows have a recovery plan, every enabled scheme has recorded compatibility evidence, and the implementation is eligible for environment rollout.

## Required Verification Matrix

| Behaviour               | Required proof                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source atomicity        | Force durable request persistence to fail; source state, version/lifecycle or Claim all roll back.                                                                 |
| Downstream independence | Commit the source while Payments handling fails; source remains committed and event becomes retryable/dead-lettered.                                               |
| Idempotency             | Deliver the same request sequentially and concurrently; one Payment, claim ID and external event exist.                                                            |
| Publication isolation   | Fail SNS publication and retry it; Payment creation is not re-entered.                                                                                             |
| Configuration readiness | Invalid declared definition is unusable; missing optional definition is usable; runtime data failure does not poison the definition.                               |
| Agreement compatibility | `303` response remains stable and lifecycle data has no Payment Hub `claimId`.                                                                                     |
| Payment compatibility   | A migrated scheme's complete CloudEvent reaches GPS unchanged and one request contains all scheduled payments; closed FPTT remains historical serializer evidence. |
| Woodland exclusion      | Agreement acceptance raises no Woodland Payment request; Claim-originated Woodland coverage still passes.                                                          |
| Operational recovery    | Admin shows the failed request and a redrive completes without duplication.                                                                                        |
| Module independence     | ESLint passes with no producer-to-Payments exceptions.                                                                                                             |
| Runtime transport       | Local end-to-end message arrives on `gps__sqs__create_payment.fifo`.                                                                                               |

Use the narrowest focused tests while implementing each package. Before cutover, run `npm run lint`, `npm test`, the end-to-end local transport scenario and the definition-specific compatibility comparisons.

## External Dependency

CDP confirmed on 24 September 2026 that a service may publish only to a topic it owns. The earlier cross-service publish-permission assumption is invalid. Merged CDP tenant request [#1849](https://github.com/DEFRA/cdp-tenant-config/pull/1849) adds the GAS-owned Agreement-status and Payment FIFO topics and the GAS and PDF subscriptions in dev, test, perf-test, ext-test and prod. The Payment Service-owned queue configuration also subscribes `gps__sqs__create_payment.fifo` to the GAS-owned Payment topic in all five environments. The remaining transport rollout is the per-environment `cdp-app-config` switch to GAS's two topic ARNs; verify live delivery to each existing consumer queue before switching. These ARN switches may be staged separately. Failed outbox rows retain their old target ARN and still need a recovery plan.

## Non-goals

- Multiple numbered Payment Hub requests or adjustments for one source.
- A pending Agreement or Claim workflow waiting for Payment completion.
- Recreating legacy Agreements API internal identifier storage.
- Agreement-originated Woodland Payment enablement.
- Dual-writing Payments from both the direct and event-driven paths.
