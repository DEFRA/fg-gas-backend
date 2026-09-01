# Woodland agreement migration plan

**Ticket:** [FGP-1372](https://eaflood.atlassian.net/browse/FGP-1372)
**Status:** Implementation in progress

## Goal

Move every legacy Woodland agreement and every observable version into GAS without changing the source meaning, triggering business processes, or activating Woodland early.

The migration must be safe to run again. Unchanged agreements must cause no GAS writes, changed migration-owned agreements must be refreshed, and unrelated GAS agreements must never be overwritten.

## Decisions

| Area | Decision |
| --- | --- |
| Direction | GAS pulls legacy data from Agreements. GAS owns the target model, mapping, validation and writes. |
| Production access | All source reads use authenticated HTTP. No production database or terminal access is required. |
| Trigger | Operators use a temporary page in `fg-grants-platform-admin`. The page calls GAS server-side. |
| Execution | GAS handles the migration synchronously and pages through source versions internally. |
| Memory | GAS holds at most one page of source versions at a time. |
| Selection | Every Woodland agreement is processed. There is no agreement filter. |
| Dry-run | Map and validate every record, write structured diagnostics, return a summary, and persist no GAS agreement data. |
| Apply | Validate every source record before starting any GAS write. Import only after validation succeeds. |
| Reruns | Store a source checksum on each migrated agreement. Skip it when the source checksum is unchanged. |
| Evidence | Store an untouched, checksummed legacy envelope inside every migrated snapshot. |
| Activation | Migration and configuration deployment do not route Woodland to GAS. Activation is a separate approved cutover step. |
| Temporary controls | Remove or disable the source routes, GAS routes, admin page and migration secrets after cutover. |

## Architecture

```text
Operator
   |
   | Entra-authenticated dry-run or apply action
   v
fg-grants-platform-admin
   |
   | Existing GAS service bearer token
   v
fg-gas-backend
   |
   | Temporary migration bearer token
   | Read-only, paginated HTTP
   v
farming-grants-agreements-api
```

Agreements exposes source data but knows nothing about the GAS domain. GAS contains the mapper and all target-side safety rules. The admin frontend contains no migration logic and never receives the GAS-to-Agreements token in the browser.

The migration is not a startup function. Cross-service work must not delay readiness, run once per replica, or rerun whenever either service is deployed.

## Temporary interfaces

### Agreements API

```http
GET /internal/migrations/woodland/agreements
GET /internal/migrations/woodland/agreements/{agreementNumber}/versions?offset={offset}
```

The list endpoint returns all Woodland agreement numbers. About 50 numbers are expected, so this response is not paginated.

The versions endpoint:

- Uses a fixed page size of 100.
- Preserves the order declared by `Grant.versions`.
- Returns the Agreement, Grant and source Version data required by the mapper.
- Returns `nextOffset` when another page exists.
- Never returns all Version documents in one response.

Both routes are registered only while the migration-token hash is configured.

### GAS

```http
POST /admin/migrations/woodland/dry-run
POST /admin/migrations/woodland/apply
```

Both endpoints use normal GAS service authentication. They are registered only while the GAS-to-Agreements migration token is configured.

The endpoints have no agreement filter, run identifier, paging parameters or persisted migration-run state.

### Grants Platform Admin

Add a temporary page:

```text
/operations/woodland-migration
```

The page is restricted to `FCP.GrantOperationsAdmin` and provides:

1. A dry-run action that displays the GAS summary and points operators to the detailed GAS logs.
2. A separate apply confirmation action that displays the reconciliation result.

The frontend calls GAS with its existing server-side `GAS_SERVICE_TOKEN`. It does not call Agreements directly.

## Dry-run

GAS performs the following steps in one request:

1. Fetch the complete Woodland agreement-number list.
2. For each agreement, request source versions in pages of 100.
3. Map each source Version through the same pure mapper used by apply.
4. Validate the mapped Agreement snapshot against the approved Woodland definition and GAS domain rules.
5. Check version order, required identifiers, lifecycle state, dates, parcels, items, quantities, amounts and timestamps.
6. Check GAS for target conflicts without writing.
7. Log a PII-safe structured result for every source record.
8. Return a small summary.

Example summary:

```json
{
  "valid": true,
  "agreements": 50,
  "versions": 5274,
  "failures": 0
}
```

Dry-run discards each page after validation. It creates no Agreement, AgreementVersion, payment, evidence record, event or migration-state record.

Logs must not contain client references, raw agreement numbers, applicant data or legacy envelopes. Record references in logs use an opaque digest and a version ordinal. The final log entry states whether the run completed and includes counts by outcome and diagnostic reason.

## Apply

Apply has a validation phase and a write phase.

### Validation phase

Apply repeats the complete dry-run mapping and validation. It refuses to write if any source record is unmappable, any diagnostic remains unresolved, the source order is inconsistent, or a target conflict exists.

During the production apply, legacy Woodland writes are paused. This makes the paginated source view stable for the duration of validation and import.

Mapped pages may be spooled to a process-local temporary file so GAS does not retain the full migration in memory or make HTTP calls inside a Mongo transaction. The file:

- Is created with restrictive permissions.
- Is never logged or exposed through an endpoint.
- Is deleted in a `finally` block.
- Lives only for the apply request.

The DEV rehearsal decides whether this spool is needed. If the complete mapped dataset and transaction fit comfortably without it, omit it.

### Write phase

After every record passes validation, GAS:

1. Compares each incoming agreement-level source checksum with the checksum on any migration-owned GAS agreement.
2. Skips agreements whose checksum is unchanged.
3. Rejects an existing agreement that is not marked as created by this migration.
4. Replaces changed migration-owned agreements from the validated source.
5. Inserts every AgreementVersion in source order and assigns the corresponding GAS version number.
6. Stores the untouched legacy envelope and its checksum in each snapshot.
7. Writes the current Agreement from the final source Version.
8. Reconciles source and target counts and checksums before returning success.

Target writes use the existing Mongo transaction helper. The DEV 5,000-version agreement is the transaction-size and duration test. If one transaction cannot safely contain the import, the fallback is an internal pending marker with a final atomic activation step. No imported Woodland record may be served before the whole run reconciles.

The migration writes through a dedicated repository path. It must not invoke normal agreement creation or lifecycle actions because those paths can publish events, create payments, call other services or generate documents.

## Mapping and evidence

The final field mapping depends on the results of FGP-1370 and [Agreements API PR 468](https://github.com/DEFRA/farming-grants-agreements-api/pull/468).

Before apply is implemented, the mapping must confirm:

- The complete set of legacy lifecycle statuses and their GAS states.
- `Grant.versions` as the authoritative version order.
- Agreement, Grant and Version timestamps used for `createdAt`, `updatedAt`, `versionedAt` and `acceptedAt`.
- Parcel identifiers and displayed area or quantity fields.
- Agreement-level payment items and parcel action items.
- Source item codes, quantities, units, annual amounts and totals.
- Applicant and business identifiers.
- The approved Woodland GAS configuration version.
- Unexpected invoices, payment schedules or other source shapes that GAS must reject.

Each imported snapshot contains an internal legacy envelope similar to:

```js
{
  source: "legacy-agreements",
  checksum: "sha256:...",
  envelope: {
    agreement: {},
    grant: {},
    version: {}
  }
}
```

The exact envelope shape will be fixed with the mapping. GAS computes the checksum from a deterministic representation and verifies it after persistence. Public response schemas, page models, events and logs must explicitly exclude the envelope.

## Rerun behaviour

Apply computes an agreement-level checksum from all source inputs used by the mapper.

| Target state | Result |
| --- | --- |
| No GAS agreement exists | Import it. |
| Migration-owned agreement has the same checksum | No-op. |
| Migration-owned agreement has a different checksum | Replace it from the complete validated source. |
| GAS agreement exists without the migration marker | Abort before any write. |
| Incomplete migration-owned data exists after an interrupted apply | Remove that agreement's incomplete migration data and rebuild it. |

The agreement-level checksum is an optimisation and idempotency marker. The per-snapshot envelope checksum is migration evidence. Neither is required during dry-run.

## Security and privacy

- Admin users authenticate through Entra and require `FCP.GrantOperationsAdmin`.
- Grants Platform Admin presents its existing service token to GAS.
- GAS stores the raw migration token in its CDP secrets.
- Agreements stores only the SHA-256 hash of that token in its CDP secrets.
- Tokens are never sent to the browser or written to logs.
- Client references and applicant details are treated as personal or pseudonymous data.
- Legacy envelopes remain internal to GAS persistence.
- Removing the migration secrets and redeploying disables the temporary routes.

## Failure and recovery

Before the first GAS write, the operator may abandon the migration and continue routing Woodland to legacy.

After the first GAS write, recovery is forward in GAS:

1. Keep Woodland routing disabled.
2. Fix the mapper, source diagnostic or operational fault.
3. Run dry-run again.
4. Run apply again.
5. Reconcile before activation.

A lost HTTP response is not proof of failure. Repeating apply is safe: complete unchanged agreements are skipped and incomplete migration-owned data is rebuilt.

If the synchronous request exceeds a real CDP timeout or a DEV pod cannot complete the 5,000-version case, stop and replace synchronous execution with resumable persisted work. Do not add that machinery before the rehearsal proves it is needed.

## Verification

### Automated checks

Agreements API:

- Migration token is required.
- Only Woodland agreements are listed.
- Pagination returns every Version exactly once in `Grant.versions` order.
- A 5,000-version fixture remains bounded by the fixed page size.

GAS:

- The mapper covers every confirmed source shape.
- Dry-run writes no domain data.
- Any unresolved diagnostic prevents all target writes.
- Apply preserves numbers, identifiers, item codes, displayed quantities and timestamps.
- Every persisted envelope verifies against its checksum.
- An unchanged rerun performs no writes.
- A changed migration-owned agreement is rebuilt.
- An unrelated target conflict aborts before writes.
- Migration emits no event and creates no payment, Payable or PDF.
- Public interfaces cannot expose the legacy envelope.

Grants Platform Admin:

- Unauthenticated and incorrectly scoped users cannot access the page.
- Actions call only the expected GAS endpoints with the server-side token.
- Apply requires an explicit confirmation.

### Environment rehearsal

In each lower environment:

1. Run dry-run over all Woodland agreements.
2. Resolve every diagnostic.
3. Run apply.
4. Compare a representative selection of rendered GAS agreement documents with legacy.
5. Include offered, accepted, multiple-version and unusual parcel or item shapes.
6. Confirm the DEV 5,000-version agreement completes within memory, request and transaction limits.
7. Run apply again and confirm zero writes.
8. Change an allowed legacy field, run again and confirm only that migration-owned agreement changes.
9. Confirm no events, payments or PDFs were produced.

Lower environments use their matching Agreements API. They do not read production data.

## Production runbook

### Before the maintenance window

- Deploy the Agreements read routes, GAS migration routes and admin page without activating Woodland.
- Configure the migration secrets in both services and redeploy.
- Confirm the approved Woodland configuration version exists in GAS.
- Confirm all lower-environment rehearsals passed.
- Confirm the source-write pause, source backup and approval owners.

### During the maintenance window

1. Pause legacy Woodland writes.
2. Take or verify the agreed source backup.
3. Run dry-run from Grants Platform Admin.
4. Check the completed summary and GAS diagnostics.
5. Stop if any diagnostic is unresolved.
6. Run apply from the separate confirmation action.
7. Reconcile agreement counts, version counts, lifecycle states and checksums.
8. Manually compare the agreed sample of rendered agreements.
9. Record approval.
10. Activate Woodland routing to GAS.

### After activation

- Monitor agreement reads and lifecycle operations.
- Remove the migration secrets and redeploy Agreements and GAS so temporary routes are unavailable.
- Remove the temporary Grants Platform Admin page.
- Remove the temporary migration code in follow-up PRs once the cutover is accepted.
- Retain the approved migration logs and reconciliation evidence according to the agreed retention policy.

## Delivery order

1. Agreements API: migration authentication, list endpoint and paginated versions endpoint.
2. GAS: pure legacy mapper and dry-run endpoint.
3. Deploy to DEV and prove the 5,000-version path.
4. GAS: apply, evidence, idempotency, conflict handling and reconciliation.
5. Grants Platform Admin: temporary dry-run and apply page.
6. Rehearse all lower environments.
7. Run the production maintenance window.
8. Disable and remove temporary migration access.

## Clarifications required before implementation is complete

FGP-1372 currently says both "offline migrator" and "migration calls no external service." Production has no terminal or source-database access, so this plan interprets:

- "Offline" as outside normal agreement workflows and run during a controlled maintenance window, not as a CLI or startup migration.
- "No external service" as no business-service calls other than the required read-only source calls to Agreements API.

The ticket should state those exceptions explicitly.

The team must also confirm:

1. The final mapping from FGP-1370 and PR 468.
2. The exact procedure for pausing legacy Woodland writes.
3. The source backup owner and evidence.
4. The approved Woodland GAS configuration version.
5. Whether the DEV 5,000-version rehearsal fits CDP request and Mongo transaction limits.
