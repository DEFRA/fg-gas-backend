# Agreement test endpoints (FGP-1411)

QA-only HTTP endpoints that let the agreement journey, accessibility and
performance suites create Agreements and drive status changes directly, instead
of going through the legacy Agreements API `POST /api/test/queue-message`
endpoint and its SQS queue abstraction.

They are **disabled by default** and are registered only when
`ENABLE_TEST_ENDPOINTS` is `true`. No queues or queue URL configuration are
involved.

## Feature flag

| Variable | Default | Effect |
| --- | --- | --- |
| `ENABLE_TEST_ENDPOINTS` | `false` | When true, the `/api/test` routes are registered and a warning is logged at startup. When false or absent, the routes are never added to the router, so requests get a plain 404. |

Environment values live in `cdp-app-config/services/fg-gas-backend`:

| Environment | Value |
| --- | --- |
| `defaults.env` | `false` |
| `dev`, `test`, `ext-test`, `perf-test` | `true` |
| `infra-dev`, `management` | inherits `false` |
| `prod` | inherits `false` — **must never be enabled** |

## `POST /api/test/agreements`

Creates a GAS-managed Agreement through the same domain behaviour as normal
processing: the payload becomes an `agreement.create` command that is handled by
`handleCreateAgreementCommandUseCase`, so validation, persistence (current
Agreement, version history) and outbox side effects are all representative.

### Request

```json
{
  "code": "pigs-might-fly",
  "clientRef": "pmf-journey-001",
  "currentConfigVersion": "1.0.1",
  "identifiers": { "sbi": "300000071", "frn": "1101234567" },
  "answers": { "whitePigsCount": 5 },
  "metadata": {}
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `code` | yes | Must be listed in `GAS_MANAGED_AGREEMENT_GRANT_CODES`, otherwise 400. |
| `clientRef` | yes | Creation is idempotent on `(code, clientRef)`: repeating a request returns the existing Agreement rather than creating a second one. Use a fresh value per scenario. |
| `currentConfigVersion` | yes | Semver of the grant config to create from. |
| `identifiers` | yes | Must contain `sbi`. Additional identifiers such as `frn` are allowed. |
| `answers` | no (defaults `{}`) | Grant-specific. Each grant's agreement definition decides what it reads via a JSONata path (PMF uses `$.input.answers`), so the shape is not validated centrally. |
| `metadata` | no (defaults `{}`) | Passed through to creation. |

### Responses

| Status | When |
| --- | --- |
| `201` | Created. Body is `{ "message": "Test agreement created", "agreementData": { ... } }`, where `agreementData.agreementNumber` is the generated number and `agreementData.state` is the initial state (`offered` for PMF). |
| `400` | Payload failed validation, the grant code is not GAS-managed, or the supplied data could not satisfy the grant's agreement definition. |
| `404` | Requested when the flag is disabled. |

## `POST /api/test/agreements/{agreementNumber}/status`

Applies a status transition through `handleUpdateAgreementStatusCommandUseCase`,
the same handler the SQS consumer uses.

### Request

```json
{ "status": "withdrawn" }
```

`status` is the **target state**, not the action name, and is lower case. Only
`withdrawn`, `cancelled` and `terminated` are accepted; anything else is a 400.

> Do not use the upper case `AgreementStatus` values (`WITHDRAWN`) from
> `src/grants/models/agreement.js` — those belong to the grants/case-status
> domain and will be rejected here.

### Responses

| Status | When |
| --- | --- |
| `200` | Transition applied. Body is `{ "message": "Test agreement status updated", "agreementData": { ... } }` with the updated `state` and incremented `version`. |
| `400` | `status` is missing or not one of the three supported values, or the Agreement's grant code is not GAS-managed. The Agreement is unchanged. |
| `404` | No Agreement exists with that agreement number. |
| `409` | The transition is not valid from the Agreement's current state. The body's `data` reports `currentState` and `requestedStatus`, and the Agreement is left in its previous state. |

### Reaching `terminated`

The lifecycle (both the `defaultAgreementLifecycle` fallback and the PMF grant
config) allows:

| From | Target states |
| --- | --- |
| `offered` | `accepted`, `withdrawn`, `cancelled` |
| `accepted` | `terminated` |
| `withdrawn`, `cancelled`, `terminated` | terminal, no transitions |

Agreements are created in `offered`, so **a newly created Agreement cannot be
terminated directly** — that request is correctly rejected with a 409. To test
termination, accept the offer first through the normal action endpoint
(`POST /agreements/{agreementNumber}/actions/accept`, which requires the
`if-match` ETag and `idempotency-key` headers) and then call this endpoint with
`terminated`.

This was a deliberate decision: the test endpoints do not add a shortcut into
`accepted`, so lifecycle rules stay identical to production behaviour.

## QA repositories that must migrate

The following suites currently create agreements and change statuses through the
legacy `farming-grants-agreements-api` endpoint
`POST /api/test/queue-message/{queueName?}` and should move to the endpoints
above:

- the agreement journey test suite
- the accessibility test suite
- the performance test suite

Migration notes for those repositories:

- Creation is synchronous. The legacy endpoint posted an SQS message and then
  polled for the agreement to appear; there is no polling or retry needed here,
  because a `201` means the Agreement is committed.
- The response envelope keeps the legacy `agreementData` key, so assertions on
  `agreementData.agreementNumber` carry over.
- Status changes use the target state (`withdrawn`), which matches the `status`
  field in the legacy queue message payload.
- These endpoints only manage GAS-owned grant codes
  (`GAS_MANAGED_AGREEMENT_GRANT_CODES`).

## Design notes

- The endpoints call the agreement use-cases directly rather than publishing
  queue messages. No new SQS queues or queue URL configuration were added, per
  FGP-1411.
- `handleUpdateAgreementStatusCommandUseCase` deliberately swallows an invalid
  transition (it logs a warning and returns nothing) so a bad queue message is
  not retried forever. Over HTTP that would look like a silent success, so the
  test use-case treats the absent result as a rejection and raises the 409
  described above.
- Route registration is conditional rather than a guard inside the handler, so
  when the flag is off there is no reachable code path at all.
