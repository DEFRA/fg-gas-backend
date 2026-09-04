# Woodland migration rollout checklist

**Jira:** [FGP-1372](https://eaflood.atlassian.net/browse/FGP-1372)
**Source API:** [farming-grants-agreements-api PR 470](https://github.com/DEFRA/farming-grants-agreements-api/pull/470)
**Dry-run and apply:** [fg-gas-backend PR 626](https://github.com/DEFRA/fg-gas-backend/pull/626)

This checklist deploys the read-only dry-run and rerunnable apply paths together. Apply remains operationally gated by the dedicated caller identity, approved dry-run checksum, expected counts and explicit confirmation. Neither endpoint activates Woodland routing.

## Values to prepare

Use separate credentials for the two authentication boundaries. Generate a new pair for every environment; never reuse DEV, TEST or PROD tokens.

| Value                               | Location                                | Secret | Purpose                                    |
| ----------------------------------- | --------------------------------------- | ------ | ------------------------------------------ |
| `WOODLAND_MIGRATION_TOKEN_HASH`     | Agreements API                          | Yes    | Authenticates GAS to the source API        |
| `WOODLAND_MIGRATION_TOKEN`          | GAS                                     | Yes    | Raw token matching the source API hash     |
| `WOODLAND_MIGRATION_SOURCE_URL`     | GAS                                     | No     | Agreements API base URL                    |
| `WOODLAND_MIGRATION_CONFIG_VERSION` | GAS                                     | No     | Exact approved Woodland definition version |
| `SERVICE_ACCESS_TOKEN_HASH`         | GAS                                     | Yes    | Seeds the credential used to call GAS      |
| `GAS_SERVICE_TOKEN`                 | Operator shell or Grants Platform Admin | Yes    | Raw caller token presented to GAS          |

> `WOODLAND_MIGRATION_TOKEN` and `GAS_SERVICE_TOKEN` are different credentials. Do not reuse one token for both boundaries.

## 1. Pre-deployment checks

- [ ] Confirm PR 470 and PR 626 have passed their required checks and approvals.
- [ ] Confirm the production diagnostic baseline is recorded: 70 agreements, 70 good, 0 bad.
- [ ] Confirm the exact approved Woodland GAS configuration version.
- [ ] Confirm that definition version exists in the target environment's GAS config catalog.
- [ ] Confirm `woodland` is **not** present in `GAS_MANAGED_AGREEMENT_GRANT_CODES`.
- [ ] Confirm the Agreements API and GAS migration settings are currently absent, so the temporary routes remain disabled.
- [ ] Confirm migration definition validation uses the read-only loader and does not update definition-cache/config fetch status.
- [ ] Record the operator, approver, expected start time and rollback owner.

## 2. Verify disabled behaviour before production

Prove the configuration gates in a lower environment before the coordinated production release. Production does not need a separate disabled-code deployment.

- [ ] Deploy PR 470 with `WOODLAND_MIGRATION_TOKEN_HASH` unset in a lower environment.
- [ ] Deploy PR 626 with all `WOODLAND_MIGRATION_*` settings unset in the same lower environment.
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
WOODLAND_MIGRATION_TOKEN_HASH=<64-character lowercase hash>
```

Configure the matching GAS secret:

```text
WOODLAND_MIGRATION_TOKEN=<raw token>
```

## 4. Configure each service

### Agreements API

- [ ] Set `WOODLAND_MIGRATION_TOKEN_HASH` as a CDP secret.
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
- [ ] Deploy the PR 626 image and all staged GAS settings to production once.
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
  "https://farming-grants-agreements-api.prod.cdp-int.defra.cloud/internal/migrations/woodland/agreements"

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

Expected production response based on the pre-migration diagnostic:

```json
{
  "valid": true,
  "agreements": 70,
  "versions": 70,
  "failures": 0,
  "sourceChecksum": "sha256:..."
}
```

- [ ] Record the response and execution timestamp in the approved operational record.
- [ ] Stop if `valid` is false, either count differs, or any failure is reported.
- [ ] Do not treat a lost HTTP response as success; inspect the completion log before deciding whether to retry.

## 8. Verify the result

Check GAS logs for the execution window.

- [ ] Exactly one `woodland-migration-dry-run-started` entry exists.
- [ ] Exactly 70 `woodland-migration-dry-run-version` success entries exist.
- [ ] No per-version failure entries exist.
- [ ] One `woodland-migration-dry-run-completed` entry exists with a success outcome.
- [ ] The completion entry reports 70 agreements, 70 versions, 70 passed and 0 failures.
- [ ] No migration log contains applicant data, client references, tokens or source envelopes.
- [ ] No Agreement or AgreementVersion migration records were created.
- [ ] No payment, Payable, PDF, lifecycle event, audit event or outbox message was created by the migration.
- [ ] Woodland routing remains on the legacy service.

## 9. Approve and apply

Do not apply from the earlier rehearsal result. During the approved maintenance window:

- [ ] Pause legacy Woodland writes.
- [ ] Take or verify the agreed source backup.
- [ ] Run dry-run again after writes are paused.
- [ ] Confirm the final result is valid with the approved 70 agreements and 70 versions.
- [ ] Record the final `sourceChecksum` and obtain explicit approval for that checksum.
- [ ] Keep Woodland routing on the legacy service.

Load the dedicated operator token without putting it in shell history:

```bash
read -rsp "GAS service token: " GAS_SERVICE_TOKEN
export GAS_SERVICE_TOKEN
echo
```

Call apply with the exact values from the approved final dry-run:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${GAS_SERVICE_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{
    "confirmation": "APPLY_WOODLAND_MIGRATION",
    "expectedAgreements": 70,
    "expectedVersions": 70,
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
  "versions": 70,
  "inserted": 70,
  "replaced": 0,
  "skipped": 0,
  "sourceChecksum": "sha256:..."
}
```

- [ ] Confirm the returned checksum exactly matches the approved dry-run checksum.
- [ ] Confirm inserted + replaced + skipped equals 70.
- [ ] Confirm the apply completion log reports success and matching counts.
- [ ] Confirm all 70 current Agreements and 70 AgreementVersions reconcile with the source checksums.
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
| GAS returns `502`                     | Source URL, raw migration token, Agreements API hash, source availability and source response shape |
| GAS returns `500`                     | The exact Woodland configuration version exists and is usable; inspect the aborted completion log   |
| GAS returns `200` with `valid: false` | Inspect each per-version diagnostic and resolve every reason before proceeding                      |
| Agreements API returns `401`          | The raw `WOODLAND_MIGRATION_TOKEN` and `WOODLAND_MIGRATION_TOKEN_HASH` do not match                 |

## 11. Disable temporary access

If this run is only a rehearsal, remove migration access immediately rather than leaving the temporary routes enabled.

- [ ] Remove `WOODLAND_MIGRATION_TOKEN_HASH` from Agreements API configuration.
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

## 12. Sign-off

- [ ] Attach the response summary and completion-log evidence to the operational record.
- [ ] Record the actual agreement/version baseline for the later maintenance window.
- [ ] Confirm the dry-run produced no definition-cache/config fetch-status writes.
- [ ] Record final reconciliation and approval before activating Woodland routing.
