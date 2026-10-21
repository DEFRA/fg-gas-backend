# FGP-1382 Claim Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver every newly submitted, configured claim to Caseworking as supplementary data, atomically with GAS claim creation and independently of case status changes.

**Architecture:** Add a validated `claims.onSubmission.processes` hook and a `STORE_CLAIM_CASE` use case in GAS. Publish a `claim.submitted` CloudEvent through the existing outbox, topic and queue; CW dispatches it to a handler that uses the existing keyed merge and writes only `supplementaryData.claims`. Enable the hook only in Woodland's `gas.next.json`.

**Tech Stack:** Existing JavaScript ESM, Node >=24, Joi, MongoDB sessions, Vitest, MongoMemoryReplSet, SNS/SQS FIFO and Pact. No new runtime dependencies.

**Spec:** [Approved design](../specs/2026-10-21-fgp-1382-claim-caseworking-design.md).

## Global Constraints

- Receiving claim data must not change the case status.
- Publish to `config.sns.updateCaseStatusTopicArn` using the existing `CloudEvent`, `saveEvents` and outbox publisher.
- CloudEvent suffix: `claim.submitted`; grouping: `${caseRef}-${workflowCode}`.
- Configuration: `claims.onSubmission.processes: ["STORE_CLAIM_CASE"]`. Absent hook or empty array disables publication; reject unknown names, duplicate names and malformed blocks.
- Exactly one claim entry per event. Map the seven claim fields and two case references exactly as specified in the design; no request-wide spread into the event.
- Insert the claim and its event with the same MongoDB session. Preserve public response, audit, duplicate suppression, payment and completion behaviour.
- CW validates the entire payload before writing, accepts a nonempty array, rejects duplicate GAS IDs within it, and merges by `gasClaimId`.
- CW persists only `supplementaryData.claims`. No workflow resolution, position changes, task/timeline changes or status publications.
- Enable only Woodland's next GAS definition. No new UI, backfill, manual approval flow, transport resources, dependency updates, deployment or publishing.
- Read gitkeeper before Git mutations; stage explicit paths only and keep each repository on its own feature branch. PRs, if subsequently requested, are drafts.

## Review Focus

1. **Replay after rollback or a concurrent duplicate:** the committed claim must have exactly one claim event. Task 2 adds replica-set tests for sequential and parallel submissions plus insertion failures.
2. **A claim that does not complete the application:** it must still publish. Task 2 tests approval-required claims, remaining capacity and absent completion configuration.
3. **Concurrent case edits:** claim ingestion must preserve newer status, task and assignment values. Task 3 tests a database edit between read and targeted write.
4. **Malformed batches or redelivery after a write:** no partial mutation for invalid batches, no duplicate stored claims on replay. Task 3 covers both cases through the real consumer.
5. **Producer/consumer drift:** exact names, casing, amount units, time and event type must agree. Task 4 generates the Pact using CW validation and verifies the real GAS builder locally.

## Workspace and evidence

The approved design is committed as `e4bcb84` on `feat/fgp-1382-claim-caseworking`. During planning, the shared GAS checkout moved to `fix/FGP-1508-legacy-service-tokens`. Do not switch that checkout, stage its files, or base this change on that unrelated branch.

This plan and a copy of the approved spec are temporarily stored under this thread's `fgp-1382/docs/superpowers/` directory. Copy them into the isolated GAS feature workspace at execution time. Use the FGP-1382 branch as the GAS starting point; preserve separate CW and Woodland workspace revisions when setting them up. Inspect their current status and any AGENTS addenda before editing.

At execution, follow using-git-worktrees and obtain the required workspace consent as part of the execution choice. Prefer BB's native workspace tools if available. Keep the running thread's directory unchanged unless the user asks to move it; shell commands can use an explicit `workdir`. Any requested thread move must use `update_environment_directory` and end that turn.

Before code changes, check dependencies and run each repository's baseline unit suite. Save logs and reports under `$BB_THREAD_STORAGE/fgp-1382/evidence/`; use unique filenames per repository/task. Diagnose baseline failures separately and report them. Existing API-create/replace tests listed below exist on the FGP-1382 branch; if the execution base changes and removes these APIs, retain definition/model/persistence coverage and update the file allowlist rather than restoring removed APIs.

## Task 1: GAS event contract and validated submission configuration

**Files (GAS):**

- Create `src/grants/events/claim-submitted.event.js` and `.test.js`.
- Modify `src/grants/schemas/grant/claims.js` and `.test.js`.
- Modify `src/grants/models/grant.js` and `.test.js`.
- Extend `src/grants/schemas/requests/create-grant-request.schema.test.js`, `src/grants/repositories/grant.repository.test.js`, and `src/grants/services/resolve-config-version.service.test.js` for the new block.
- Extend `test/grants/create-grant.test.js` to prove configuration persistence through the existing API.

**Interfaces:** `new ClaimSubmittedEvent({ claim, claimId }) -> CloudEvent`, where `claim` is a saved `Claim` and `claimId` is its string Mongo ID. `claims` remains the exported Joi schema; `Grant` validates the submission hook when constructed from a published definition or stored document. Invalid published configuration raises `Boom.badImplementation` to follow the existing permanent-definition-failure path.

- [x] **Write failing event/config tests.** Use code `woodland`, reference `wmp-6hb-j8e`, GAS ID `507f1f77bcf86cd799439011`, client claim reference `WMP-6HB-J8E-C0001`, claim code `ENT_CS_CAPITAL_PA3`, SBI `113593357`, saved time `2026-08-07T11:16:05.745Z`, and amount `150000`:

  ```js
  expect(event.data).toEqual({
    caseRef: "wmp-6hb-j8e",
    workflowCode: "woodland",
    claims: [
      {
        gasClaimId: "507f1f77bcf86cd799439011",
        clientClaimRef: "WMP-6HB-J8E-C0001",
        claimCode: "ENT_CS_CAPITAL_PA3",
        claimAmountPence: 150000,
        sbi: "113593357",
        status: "SUBMITTED",
        submittedAt: "2026-08-07T11:16:05.745Z",
      },
    ],
  });
  expect(event.type).toBe("cloud.defra.local.fg-gas-backend.claim.submitted");
  expect(event.messageGroupId).toBe("wmp-6hb-j8e-woodland");
  expect(event.data).not.toHaveProperty("newStatus");
  ```

  Test zero amount, ignoring unrelated request metadata/answers, saved timestamp rather than a differing request timestamp, and real CloudEvent envelope fields. Schema/model cases: absent hook, `{ processes: [] }`, one known process, missing/non-array processes, unknown name, duplicate name and unknown hook keys. Assert API/persistence round trips retain the block and a bad published hook is latched as a permanent definition error.

- [x] **Run the new tests red:** `npm run test:unit -- --run src/grants/events/claim-submitted.event.test.js src/grants/schemas/grant/claims.test.js src/grants/models/grant.test.js src/grants/schemas/requests/create-grant-request.schema.test.js src/grants/repositories/grant.repository.test.js src/grants/services/resolve-config-version.service.test.js`. Confirm failure concerns the missing feature.
- [x] **Implement the interfaces.** Extend `CloudEvent` with the specified mapping and group. Add the optional Joi hook with `.unique()` and known-name validation. Reuse that validation for the new hook in the Grant construction path; do not introduce full-definition validation or alter other transition logic.
- [ ] **Run green and persistence checks:** repeat the unit command, then `npm run test:integration -- --run test/grants/create-grant.test.js` against the existing Docker integration harness. Save JSON test reports and command logs in thread storage.
- [x] **Commit the explicit Task 1 files** with subject `Define submitted claim events and submission hooks` after scoped diff review.

## Task 2: Run STORE_CLAIM_CASE inside claim submission's transaction

**Files (GAS):**

- Create `src/grants/use-cases/store-claim-case.use-case.js` and `.test.js`.
- Modify `src/grants/services/claims.service.js` and `.test.js`.
- Create `src/grants/services/claim-submission-caseworking.integration.test.js`.
- Extend `src/grants/services/claim-submission-transition.integration.test.js`, `src/grants/services/claim-submission-payment.integration.test.js`, and `test/grants/submit-claim.test.js` for joint-behaviour assertions.

**Interfaces:** `storeClaimCaseUseCase({ claim, claimId }, session) -> Promise<void>` consumes Task 1's event builder and `saveEvents`. `insertClaim`'s internal result becomes `{ created: true, claimId, createdAt, savedClaim }`; its existing audit callback still sees `claimId`. `submitInTransaction` removes `savedClaim` and `createdAt` from the public result. An internal helper `runClaimSubmissionProcesses({ grant, claim, claimId }, session)` invokes the known configured process in order, with no generic dispatcher extraction.

- [x] **Write the failing transactional tests.** Follow the existing MongoMemoryReplSet claim-transition integration fixture pattern; seed one application, grant and entitlement per test. Add a helper counting only outbox rows ending in `.claim.submitted`, so audit/payment/status events cannot satisfy the assertion.

  ```js
  expect(result).toEqual({ created: true, claimId: expect.any(String) });
  expect(claimEvents).toHaveLength(1);
  expect(claimEvents[0].event.data.claims[0].gasClaimId).toBe(result.claimId);
  expect(await submitClaim(command)).toEqual({ created: false });
  expect(await countClaimEvents()).toBe(1);
  ```

  Cover concurrent identical submissions, both duplicate checks, approval-required claims, multiple entitlements/remaining capacity, partial claims, absent completion config, hook absent/empty, and the final configured claim. Compare payment/status event counts and application position to the corresponding existing behaviour. Force an outbox insertion failure after claim insertion and a claim insertion failure; after rejection assert no claim or claim event committed. Exercise the real MongoDB transaction, not a mocked transaction wrapper.

- [x] **Run red:** `npm run test:unit -- --run src/grants/use-cases/store-claim-case.use-case.test.js src/grants/services/claims.service.test.js src/grants/services/claim-submission-caseworking.integration.test.js`.
- [x] **Implement the submission hook.** Keep the saved immutable Claim accessible after insert, call `runClaimSubmissionProcesses` after insertion/audit and before `transitionOnFinalClaim`, and pass the same session through `storeClaimCaseUseCase` to `saveEvents`. Let publication insertion errors propagate. Preserve replay early returns and the API's result shape.
- [ ] **Run green and regressions:** run the new tests plus `src/grants/services/claim-submission-transition.integration.test.js` and `src/grants/services/claim-submission-payment.integration.test.js`; run `npm run test:integration -- --run test/grants/submit-claim.test.js`. Verify rejected submissions, 201/200 responses and failures leave the intended row counts.
- [x] **Commit the explicit Task 2 files** with subject `Queue Caseworking claim data with claim creation`.

## Task 3: CW ingestion that updates only claim supplementary data

**Files (CW):**

- Create `src/cases/schemas/claim-submitted.schema.js` and `.test.js`.
- Create `src/cases/use-cases/handle-claim-submitted.use-case.js` and `.test.js`.
- Modify `src/cases/repositories/case.repository.js` and `.test.js`.
- Modify `src/cases/subscribers/inbox.subscriber.js` and `.test.js`.
- Create `test/cases/claim-submitted.test.js`.

**Interfaces:** `claimSubmittedDataSchema` validates the event data in the approved spec with `convert: false`. `handleClaimSubmittedUseCase(message) -> Promise<void>` consumes the same inbox message shape as `handleCaseStatusUpdateUseCase`. `updateClaimSupplementaryData(kase) -> Promise<void>` issues an acknowledged `updateOne` by `kase.objectId`, setting only `"supplementaryData.claims"` to the merged array; missing cases or unacknowledged writes raise errors like the existing repository functions. Register `cloud.defra.ENV.fg-gas-backend.claim.submitted` in the existing `useCaseMap`.

- [x] **Write failing consumer/repository tests.** Assert required references/identifiers, nonnegative integer amounts (zero accepted), literal status, ISO timestamp, nonempty array and unique GAS IDs. Reject malformed later entries before any write. Test append, repeated delivery, two distinct claims, missing case, database error and dispatch. Unit tests must assert that workflow/position/status publishing functions are not called.

  ```js
  expect(stored.supplementaryData.claims).toHaveLength(1); // after redelivery
  expect(stored.supplementaryData.claims[0].gasClaimId).toBe(gasClaimId);
  expect(stored.currentStatus).toBe(original.currentStatus);
  expect(stored.timeline).toEqual(original.timeline);
  expect(stored.phases).toEqual(original.phases);
  expect(stored.supplementaryData.agreements).toEqual(
    original.supplementaryData.agreements,
  );
  ```

  In the database integration test, change the stored status/tasks/assignment after the handler's read but before its write, then assert those newer values survive. Invoke the real inbox handler/dispatcher using a dedicated test database so the running poller cannot consume fixtures. Invoke twice to simulate a crash after storage but before inbox completion. An invalid batch must leave the complete case unchanged.

- [x] **Run red:** `npm run test:unit -- --run src/cases/schemas/claim-submitted.schema.test.js src/cases/use-cases/handle-claim-submitted.use-case.test.js src/cases/repositories/case.repository.test.js src/cases/subscribers/inbox.subscriber.test.js`.
- [x] **Implement validation, merge and targeted write.** Validate the entire payload, find the case by references, and apply existing `Case.updateSupplementaryData` once per claim with node `claims`, type `ARRAY`, key `gasClaimId`. Persist through the narrow repository function. Do not modify `progress-case.use-case.js` or call the whole-document `update` function.
- [ ] **Run green and database checks:** repeat the unit command, then `npm run test:integration -- --run test/cases/claim-submitted.test.js test/cases/inbox-service.test.js`. Confirm failures are visible to the existing inbox retry machinery and successful processing produces no status outbox event.
- [x] **Commit the explicit Task 3 files** with subject `Store submitted claims in case supplementary data`.

## Task 4: Verify the new contract across real producer and consumer

**Files:** GAS `test/contract/provider.cw-backend.test.js`; CW `test/contract/consumer.gas-backend.test.js`. Generated pacts stay in ignored temporary directories or thread storage, not in the commit.

**Interfaces:** interaction name `a submitted claim event from GAS`. CW's MessageConsumerPact validates the received `data` using Task 3's production schema; GAS's MessageProviderPact supplies a real Task 1 `ClaimSubmittedEvent`. Use lowercase `specversion`, matching the actual CloudEvent implementation, even where older interactions spell it differently. Do not repair unrelated legacy interactions in this task.

- [x] **Write the consumer interaction and run red** before adding the provider entry. Pin the event type, identifiers, numeric pence amount and timestamp format. Assert both `newStatus` and `supplementaryData` wrappers are absent from this event's `data`.
- [x] **Add the provider entry** using the real saved Claim fixture and inserted-ID-shaped string from Task 1.
- [x] **Run local contracts:** in CW, `npm run test:contract:local -- --run test/contract/consumer.gas-backend.test.js`; in GAS, set `PACT_USE_LOCAL=true PACT_LOCAL_DIR=<CW-workspace>/tmp/pacts` and run `npm run test:contract -- --run test/contract/provider.cw-backend.test.js`. Save logs and reports. Verify the new interaction actually ran; no broker publishing. If older interactions fail, distinguish those from the new interaction and preserve the evidence.
- [x] **Commit each repository's explicit contract file** with subject `Verify submitted claim message compatibility`.

## Task 5: Activate Woodland next and verify the complete change

**Files (Woodland):**

- Modify `configurations/woodland/gas/gas.next.json`.
- Create `test/configurations/woodland-claims.test.js`.
- Create `.changeset/woodland-claim-caseworking.md` using the existing changeset format and a patch entry for `grants-config-woodland`.

**Files (GAS documentation):** `docs/superpowers/specs/2026-10-21-fgp-1382-claim-caseworking-design.md` and `docs/superpowers/plans/2026-10-21-fgp-1382-claim-caseworking.md` copied from thread storage; update review/progress checkboxes only as completed.

- [x] **Write the failing configuration test.** Load the JSON using `readFile`/`JSON.parse` so the actual next definition is checked. Assert `claims.onSubmission.processes` equals `["STORE_CLAIM_CASE"]`; `requiresApproval` remains false; `claims.onClaimApproval` still maps Awaiting Claim to Claim Complete. Assert the default GAS definition has no new hook. Keep byte-for-byte diffs of unrelated configuration out of the change.
- [x] **Run red:** `npm exec vitest run test/configurations/woodland-claims.test.js` from the Woodland workspace.
- [x] **Add the hook and changeset.** Do not modify default `gas.json`, `cw.json`, `cw.next.json`, package versions or lockfiles. The changeset describes delivering claim supplementary data while retaining the existing completion path.
- [ ] **Run green and final checks.** GAS: relevant claim/config unit suites, the two claim integration suites from Task 2, affected Docker integration tests, lint and format checks. CW: Task 3 unit/database suites, existing case progression regressions, lint and format checks. Woodland: `npm test`, `npm run lint`, `npm run format:check`. Save test JSON and command logs; save lint findings in machine-readable form. Check every changed repository's diff for whitespace, unrelated files and accidentally recorded payloads/secrets. Run Task 4's local contracts once after the final event changes, if any.
- [x] **Run independent review** against the approved spec and file allowlist. Use the execution method chosen by the user and its required review skill. Address concrete findings and rerun only affected checks; record unresolved limitations without claiming completion.
- [x] **Commit the explicit configuration/test/changeset files** with subject `Enable Caseworking claim delivery for Woodland next`; commit updated design/plan tracking in GAS separately if needed.
- [x] **Report delivery** with branches, commit subjects, automated-check evidence and remaining deployment checks. CW must be deployed before the hook is enabled in a published definition; deployed subscription filters must accept the new type. This task prepares changes only and does not deploy, publish configuration, push or open PRs.

## Execution outcome

All five implementation tasks are committed across the GAS, CW and Woodland feature branches. Runnable suites, real MongoDB transaction/ingestion tests and the new Pact interaction passed. Verification checkboxes that include unavailable Docker checks remain open; their runnable portions passed. Docker-backed API/queue checks could not start because the Docker socket is inaccessible; their logs are in thread storage.

Independent review found that an existing whole-case replacement could erase claim data when it committed after ingestion. The fix preserves the latest stored claims atomically during general case updates; a database regression first reproduced the loss and then passed for both new and existing claims. The schema file lives under CW models to comply with enforced import rules. Full execution rulings and evidence remain in this thread's storage.

## Self-review and execution choice

- [x] Every approved requirement is assigned to a task.
- [x] New interfaces and event field mappings are consistent across tasks.
- [x] Rollback, idempotency, non-final claims, unchanged status and contract compatibility have explicit tests.
- [x] File allowlists distinguish all three repositories and preserve unrelated shared-checkout work.
- [x] User approved the plan; native execution with independent review.

**Recommendation: Native execution.** These five tasks share a small event contract and depend closely on each other's interfaces; one implementer can preserve that context, followed by an independent review of the whole change. Subagent-driven execution offers independent review after each task at the cost of additional handoffs and contexts.
