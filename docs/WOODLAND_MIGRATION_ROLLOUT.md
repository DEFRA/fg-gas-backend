# Woodland migration rollout checklist

**Jira:** [FGP-1372](https://eaflood.atlassian.net/browse/FGP-1372)
**Source API:** [farming-grants-agreements-api PR 470](https://github.com/DEFRA/farming-grants-agreements-api/pull/470)
**Dry-run and apply:** [fg-gas-backend PR 626](https://github.com/DEFRA/fg-gas-backend/pull/626) and [history reconstruction PR 644](https://github.com/DEFRA/fg-gas-backend/pull/644)

This checklist deploys the read-only dry-run, rerunnable apply and post-cutover catch-up paths together. Apply remains operationally gated by the dedicated caller identity, approved dry-run checksum, expected counts and explicit confirmation. Catch-up uses the same dedicated identity and re-validates the whole source on every call. None of these endpoints activates Woodland routing.

## Values to prepare

Use separate credentials for the two authentication boundaries. Generate a new pair for every environment; never reuse DEV, TEST or PROD tokens.

| Value                               | Location                                | Secret | Purpose                                    |
| ----------------------------------- | --------------------------------------- | ------ | ------------------------------------------ |
| `MIGRATION_SOURCE_TOKEN_HASH`       | Agreements API                          | Yes    | Authenticates GAS to the source API        |
| `WOODLAND_MIGRATION_TOKEN`          | GAS                                     | Yes    | Raw token matching the source API hash     |
| `WOODLAND_MIGRATION_SOURCE_URL`     | GAS                                     | No     | Agreements API base URL                    |
| `WOODLAND_MIGRATION_CONFIG_VERSION` | GAS                                     | No     | Exact approved Woodland definition version |
| `SERVICE_ACCESS_TOKEN_HASH`         | GAS                                     | Yes    | Seeds the credential used to call GAS      |
| `GAS_SERVICE_TOKEN`                 | Operator shell or Grants Platform Admin | Yes    | Raw caller token presented to GAS          |

> `WOODLAND_MIGRATION_TOKEN` and `GAS_SERVICE_TOKEN` are different credentials. Do not reuse one token for both boundaries.

## 1. Pre-deployment checks

- [ ] Confirm PR 470, PR 626 and PR 644 have passed their required checks and approvals.
- [ ] Confirm the production diagnostic baseline is recorded: 70 agreements, 70 good, 0 bad.
- [ ] Confirm the exact approved Woodland GAS configuration version.
- [ ] Confirm that definition version exists in the target environment's GAS config catalog.
- [ ] Confirm `woodland` is **not** present in `GAS_MANAGED_AGREEMENT_GRANT_CODES`.
- [ ] Confirm the Agreements API and GAS migration settings are currently absent, so the temporary routes remain disabled.
- [ ] Confirm migration definition validation uses the read-only loader and does not update definition-cache/config fetch status.
- [ ] Record the operator, approver, expected start time and rollback owner.

## 2. Verify disabled behaviour before production

Prove the configuration gates in a lower environment before the coordinated production release. Production does not need a separate disabled-code deployment.

- [ ] Deploy PR 470 with `MIGRATION_SOURCE_TOKEN_HASH` unset in a lower environment.
- [ ] Deploy a GAS image containing PR 626 and PR 644 with all `WOODLAND_MIGRATION_*` settings unset in the same lower environment.
- [ ] Confirm both services are healthy.
- [ ] Confirm the temporary source routes and GAS dry-run/apply routes are unavailable.
- [ ] Confirm normal agreement processing remains unchanged.
- [ ] Complete the configured dry-run, first apply, unchanged rerun and changed-source rebuild rehearsal in lower environments.

## 3. Create the GAS-to-Agreements credential

Run this from the `fg-gas-backend` repository:

```bash
npm run token:new -- fg-gas-backend
```

The command prints a line containing `fg-gas-backend:<HASH>` and then the raw token.

- [ ] Capture the raw token immediately in the approved secret store.
- [ ] Copy only the 64-character hash, without the `fg-gas-backend:` prefix.
- [ ] Do not paste either value into Jira, GitHub, Slack or application logs.

Configure the Agreements API secret:

```text
MIGRATION_SOURCE_TOKEN_HASH=<64-character lowercase hash>
```

Configure the matching GAS secret:

```text
WOODLAND_MIGRATION_TOKEN=<raw token>
```

## 4. Configure each service

### Agreements API

- [ ] Set `MIGRATION_SOURCE_TOKEN_HASH` as a CDP secret.
- [ ] Confirm it is exactly 64 lowercase hexadecimal characters.
- [ ] Stage the secret for the coordinated production deployment.

Production source URL:

```text
https://farming-grants-agreements-api.prod.cdp-int.defra.cloud
```

### GAS

Set:

```text
WOODLAND_MIGRATION_SOURCE_URL=https://farming-grants-agreements-api.prod.cdp-int.defra.cloud
WOODLAND_MIGRATION_TOKEN=<raw GAS-to-Agreements token>
WOODLAND_MIGRATION_CONFIG_VERSION=<approved exact version>
```

- [ ] Store `WOODLAND_MIGRATION_TOKEN` as a CDP secret.
- [ ] Add the source URL and config version to the environment configuration.
- [ ] Reconfirm `woodland` has not been added to `GAS_MANAGED_AGREEMENT_GRANT_CODES`.
- [ ] Stage all three settings for the coordinated production deployment.

The GAS routes are enabled only when all three settings are non-empty. Apply still accepts only the `woodland-migration-operator` service identity and an approved request payload.

## 5. Create the operator-to-GAS credential

An existing approved GAS service token may call dry-run, but apply requires the dedicated `woodland-migration-operator` identity. Create that credential from `fg-gas-backend`:

```bash
npm run token:new -- woodland-migration-operator
```

Use the generated values as follows:

```text
# GAS CDP secret — include the client prefix
SERVICE_ACCESS_TOKEN_HASH=woodland-migration-operator:<64-character hash>

# Caller-side secret — raw token only
GAS_SERVICE_TOKEN=<raw token>
```

- [ ] Check whether `SERVICE_ACCESS_TOKEN_HASH` already has a value before replacing it.
- [ ] Record any previous value securely so it can be restored.
- [ ] Stage `SERVICE_ACCESS_TOKEN_HASH` on GAS exactly as printed.
- [ ] Deploy the PR 470 image and staged Agreements API secret to production.
- [ ] Deploy a GAS image containing PR 626 and PR 644 with all staged GAS settings to production once.
- [ ] Confirm both services are healthy and the temporary routes are registered.
- [ ] Confirm the following GAS startup message appears:

```text
Seeded access token for woodland-migration-operator
```

GAS deliberately continues starting if token seeding fails. Do not proceed if the success message is absent or a seeding error is logged.

## 6. Optional source-route smoke test

Run this only from an approved environment that can reach the internal CDP URL. Do not save the returned source data outside approved logs or storage.

```bash
read -rsp "GAS-to-Agreements migration token: " WOODLAND_MIGRATION_TOKEN
export WOODLAND_MIGRATION_TOKEN
echo

curl --fail-with-body \
  --header "Authorization: Bearer ${WOODLAND_MIGRATION_TOKEN}" \
  "https://farming-grants-agreements-api.prod.cdp-int.defra.cloud/internal/migrations/agreements?code=woodland"

unset WOODLAND_MIGRATION_TOKEN
```

- [ ] Confirm the request returns HTTP 200.
- [ ] Confirm the list contains the expected 70 Woodland agreement numbers.
- [ ] Do not proceed if the count differs unexpectedly.

## 7. Invoke the GAS dry-run

Prefer Grants Platform Admin so the GAS service token stays server-side. For an approved manual invocation, load the raw caller token without putting it in shell history:

```bash
read -rsp "GAS service token: " GAS_SERVICE_TOKEN
export GAS_SERVICE_TOKEN
echo

curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${GAS_SERVICE_TOKEN}" \
  "https://fg-gas-backend.prod.cdp-int.defra.cloud/admin/migrations/woodland/dry-run"

unset GAS_SERVICE_TOKEN
```

No request body or caller-token header is required.

For example, if the final source contains 20 offered and 50 accepted agreements, the response is:

```json
{
  "valid": true,
  "agreements": 70,
  "offeredAgreements": 20,
  "acceptedAgreements": 50,
  "versions": 120,
  "failures": 0,
  "sourceChecksum": "sha256:..."
}
```

Treat the final dry-run's state counts, target version count and checksum—not the example values above—as the approved migration baseline.

- [ ] Record the response and execution timestamp in the approved operational record.
- [ ] Stop if `valid` is false, `failures` is not zero, `agreements` is not 70, or `offeredAgreements + acceptedAgreements` is not 70; otherwise record the returned `versions` count and checksum as the baseline.
- [ ] Do not treat a lost HTTP response as success; inspect the completion log before deciding whether to retry.

## 8. Verify the result

Check GAS logs for the execution window.

- [ ] Exactly one `woodland-migration-dry-run-started` entry exists.
- [ ] The number of `woodland-migration-dry-run-version` success entries equals the returned `versions` count.
- [ ] No per-version failure entries exist.
- [ ] One `woodland-migration-dry-run-completed` entry exists with a success outcome.
- [ ] The completion entry reports the returned agreement, final-state and version counts, with every target version passed and 0 failures.
- [ ] No migration log contains applicant data, client references, tokens or source envelopes.
- [ ] No Agreement or AgreementVersion migration records were created.
- [ ] No payment, Payable, PDF, lifecycle event, audit event or outbox message was created by the migration.
- [ ] Woodland routing remains on the legacy service.

## 9. Approve and apply

Do not apply from the earlier rehearsal result. During the approved maintenance window:

- [ ] Pause legacy Woodland writes.
- [ ] Take or verify the agreed source backup.
- [ ] Run dry-run again after writes are paused.
- [ ] Confirm no GAS deployment occurs between this final dry-run and apply.
- [ ] Confirm the final result is valid with 70 agreements, `offeredAgreements + acceptedAgreements = 70`, and record the returned target `versions` count.
- [ ] Record the final `sourceChecksum` and obtain explicit approval for that checksum.
- [ ] Keep Woodland routing on the legacy service.

Load the dedicated operator token without putting it in shell history:

```bash
read -rsp "GAS service token: " GAS_SERVICE_TOKEN
export GAS_SERVICE_TOKEN
echo
```

Call apply with the exact values from the approved final dry-run. The example below uses the illustrative target version count of 120; replace it with the returned `versions` value.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${GAS_SERVICE_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{
    "confirmation": "APPLY_WOODLAND_MIGRATION",
    "expectedAgreements": 70,
    "expectedVersions": 120,
    "sourceChecksum": "sha256:<checksum-from-final-dry-run>"
  }' \
  "https://fg-gas-backend.prod.cdp-int.defra.cloud/admin/migrations/woodland/apply"

unset GAS_SERVICE_TOKEN
```

Expected first-apply response:

```json
{
  "valid": true,
  "agreements": 70,
  "offeredAgreements": 20,
  "acceptedAgreements": 50,
  "versions": 120,
  "inserted": 70,
  "replaced": 0,
  "skipped": 0,
  "sourceChecksum": "sha256:..."
}
```

- [ ] Confirm the returned checksum exactly matches the approved dry-run checksum.
- [ ] Confirm inserted + replaced + skipped equals 70.
- [ ] Confirm the apply completion log reports success and matching counts.
- [ ] Confirm all 70 current Agreements and the approved target number of AgreementVersions reconcile with the source checksums.
- [ ] Confirm every persisted snapshot envelope verifies against its checksum.
- [ ] Confirm no payment, Payable, PDF, lifecycle event, audit event or outbox message was produced.
- [ ] Keep routing disabled until the separate reconciliation and approval are recorded.

An unchanged rerun is safe and should return `inserted: 0`, `replaced: 0`, and `skipped: 70`. If the HTTP response is lost, rerun with the same approved payload and verify this no-op result. A changed source requires a new dry-run and approval because the previous checksum will be rejected.

## 10. Troubleshooting

| Result                                | Check                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GAS returns `404`                     | All three GAS migration settings are present and GAS was redeployed                                 |
| GAS returns `401`                     | `GAS_SERVICE_TOKEN` is the raw caller token and its hash was successfully seeded in GAS             |
| Apply returns `403`                   | The caller credential is not the dedicated `woodland-migration-operator` identity                   |
| Apply returns `409`                   | Validation failed, source checksum/counts changed, or existing GAS data conflicts                   |
| Catch-up returns `409`                | Whole-source validation failed; run dry-run, resolve every per-version reason, then retry catch-up  |
| GAS returns `502`                     | Source URL, raw migration token, Agreements API hash, source availability and source response shape |
| GAS returns `500`                     | The exact Woodland configuration version exists and is usable; inspect the aborted completion log   |
| GAS returns `200` with `valid: false` | Inspect each per-version diagnostic and resolve every reason before proceeding                      |
| Agreements API returns `401`          | The raw `WOODLAND_MIGRATION_TOKEN` and `MIGRATION_SOURCE_TOKEN_HASH` do not match                   |

## 11. Disable temporary access

If this run is only a rehearsal, remove migration access immediately rather than leaving the temporary routes enabled.

- [ ] Remove `MIGRATION_SOURCE_TOKEN_HASH` from Agreements API configuration.
- [ ] Remove `WOODLAND_MIGRATION_SOURCE_URL`, `WOODLAND_MIGRATION_TOKEN` and `WOODLAND_MIGRATION_CONFIG_VERSION` from GAS.
- [ ] Redeploy Agreements API and GAS.
- [ ] Confirm the source routes and GAS dry-run/apply routes now return `404`.

### Revoke a temporary GAS caller token

Removing `SERVICE_ACCESS_TOKEN_HASH` does **not** remove the previously seeded database credential. Rotate the same client to an unknown token before restoring or removing the bootstrap setting.

Generate a replacement hash without printing or retaining its raw token:

```bash
node --input-type=module -e '
  import { createHash, randomBytes } from "node:crypto";
  const unknownToken = randomBytes(32);
  const hash = createHash("sha256").update(unknownToken).digest("hex");
  console.log(`woodland-migration-operator:${hash}`);
'
```

- [ ] Set the printed pair as GAS `SERVICE_ACCESS_TOKEN_HASH`.
- [ ] Redeploy GAS and confirm the operator credential was replaced.
- [ ] Confirm the original `GAS_SERVICE_TOKEN` now receives HTTP 401.
- [ ] Restore the previous `SERVICE_ACCESS_TOKEN_HASH`, or remove it if none existed.
- [ ] Redeploy GAS again if the bootstrap setting changed.
- [ ] Delete local copies of the original raw operator token.

## 12. Catch-up after cutover

Use catch-up after the maintenance window and Woodland cutover to reconcile GAS with legacy progress made after apply, typically an `offered` agreement becoming `accepted`, or to create an agreement missed by the apply run.

Use the dedicated `woodland-migration-operator` token. The strict bodyless call has no approval payload or prior dry-run requirement: a supplied body is rejected with `400`. Catch-up re-validates the complete source before it processes any agreement; it returns `409` and writes nothing when whole-source validation fails.

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${GAS_SERVICE_TOKEN}" \
  "https://fg-gas-backend.prod.cdp-int.defra.cloud/admin/migrations/woodland/catch-up"
```

Example response:

```json
{
  "valid": true,
  "agreements": 70,
  "offeredAgreements": 19,
  "acceptedAgreements": 51,
  "versions": 121,
  "inserted": 0,
  "updated": 1,
  "preserved": 69,
  "failed": 0,
  "failures": [],
  "sourceChecksum": "sha256:..."
}
```

- `inserted`: a missing agreement and its history were created.
- `updated`: a migration-owned agreement's source checksum changed, so that agreement and its history were rewritten.
- `preserved`: no write was needed because the checksum was unchanged, or a normal GAS action removed the migration marker and took ownership.
- `failed`: a per-agreement conflict or write error occurred; details are listed in `failures[]`, and later agreements were still processed.

Failure reasons and actions:

| Reason              | Operator action                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `identity.mismatch` | Another agreement holds the source identity; investigate manually                                   |
| `history.orphaned`  | Version documents exist without a current agreement; perform an approved data fix                   |
| `marker.conflict`   | A GAS action won the race; inspect the completion log before deciding whether to run catch-up again |
| `write.conflict`    | Inspect the completion log and treat the agreement as a transient conflict                          |
| `write.error`       | Inspect service health and logs before deciding whether to run catch-up again                       |

After whole-source validation succeeds, catch-up processes prepared agreements sequentially, each in its own transaction. Marker-scoped conditional writes cannot overwrite a concurrent normal GAS action; a failed agreement does not block later agreements. Catch-up creates no payment, Payable, PDF, lifecycle event, audit event or outbox message. It has no general rerun guarantee: when the source and ownership are unchanged after a successful run, each agreement is preserved without a write.

If the HTTP response is lost, inspect the `woodland-migration-catch-up-completed` log before deciding whether another invocation is needed.

## 13. Sign-off

- [ ] Attach the response summary and completion-log evidence to the operational record.
- [ ] Record the actual agreement/version baseline for the later maintenance window.
- [ ] Confirm the dry-run produced no definition-cache/config fetch-status writes.
- [ ] Record final reconciliation and approval before activating Woodland routing.
