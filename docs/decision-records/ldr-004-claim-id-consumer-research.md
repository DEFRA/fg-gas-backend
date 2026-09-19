# LDR-004 research: consumers of Payment Hub `claimId` on AgreementStatusUpdated

**Research date:** 18 September 2026

**Scope:** source and deployment configuration visible in the DEFRA GitHub organisation

**Question:** Is the external Payment Service the only confirmed user of the Payment Hub `claimId`, and does any DEFRA repository consume that field from `io.onsite.agreement.status.updated`?

## Answer

**Within the searched DEFRA source, yes: the Grants Payment Service is the only confirmed semantic user of the Payment Hub `claimId`, and no DEFRA repository was found reading that field from `AgreementStatusUpdated`.**

The distinction between the two event paths is important:

- [`DEFRA/grants-payment-service`](https://github.com/DEFRA/grants-payment-service) consumes `claimId` from the **payment-creation** message, persists it as required data, and maps it to Payment Hub `contractNumber`. This is a confirmed field consumer, but it does **not** subscribe to or mention `io.onsite.agreement.status.updated`.
- The Agreement lifecycle event has two source-controlled production subscribers: `fg-gas-backend` and `farming-grants-agreements-pdf`. Both consume other fields from the event; neither has field-specific code for `claimId`.
- Both Agreement implementations publish `claimId` on an accepted lifecycle event. Those are producer-side uses. Scripts, unit tests, provider tests and copied sample payloads containing the field are not consumers.

This is a source-evidence conclusion, not proof of the complete live AWS topology. Runtime/manual subscriptions, code outside repositories visible to the authenticated identity, non-default branches and consumers outside the DEFRA organisation remain residual uncertainty.

## What counts as a consumer

For this research, a **confirmed `claimId` consumer** must address the field specifically: for example by accessing or destructuring it, declaring it in a consumer schema, validating it, persisting it as a required field, or using it in business logic.

The following are recorded but are **not** treated as field consumers:

- storing an incoming CloudEvent envelope unchanged in a generic inbox;
- logging or displaying an entire payload generically;
- forwarding the whole `data` object into generic audit detail;
- defining an SNS/SQS subscription without source showing which payload fields are read;
- publishing the field;
- asserting a copied producer payload in a test or fixture.

That boundary matters for `fg-gas-backend`: it preserves the incoming event and can expose the payload in generic Admin/audit views, but no code found names or depends on `eventData.claimId`.

`claimId` in this report means the Payment Hub identifier in the form `R########`. It does not mean a Claim domain record ID, an insurance claim identifier, or another service's arbitrary field with the same spelling.

## Confirmed consumer: Grants Payment Service, on a different event

`DEFRA/grants-payment-service` is a confirmed consumer of the Payment Hub identifier on its `create_payment` queue:

1. Runtime wiring registers `handleCreatePaymentEvent` against the create-payment SQS queue: [`src/server.js`](https://github.com/DEFRA/grants-payment-service/blob/e85f77958cc3d165610d34affd20d898d7a916c7/src/server.js#L86-L98).
2. The handler reads `grantPayment.claimId` from the persisted incoming `payload.data` and passes it as an identifier: [`src/common/helpers/sqs/message-processor/handle-create-payment.js`](https://github.com/DEFRA/grants-payment-service/blob/e85f77958cc3d165610d34affd20d898d7a916c7/src/common/helpers/sqs/message-processor/handle-create-payment.js#L15-L35).
3. The Mongo schema requires `claimId`: [`src/api/common/models/grant_payments.js`](https://github.com/DEFRA/grants-payment-service/blob/e85f77958cc3d165610d34affd20d898d7a916c7/src/api/common/models/grant_payments.js#L100-L107).
4. The Payment Hub transformer maps it to `contractNumber`: [`src/common/helpers/payment-hub/transformers/index.js`](https://github.com/DEFRA/grants-payment-service/blob/e85f77958cc3d165610d34affd20d898d7a916c7/src/common/helpers/payment-hub/transformers/index.js#L64-L90).
5. Its consumer Pact is for `cloud.defra.dev.farming-grants-agreements-api.payment.create` on `create_payment.fifo`, not the Agreement lifecycle event: [`src/contracts/consumer/agreements-to-gps.contract.test.js`](https://github.com/DEFRA/grants-payment-service/blob/e85f77958cc3d165610d34affd20d898d7a916c7/src/contracts/consumer/agreements-to-gps.contract.test.js#L64-L90).

A repository-wide search in this service for the lifecycle identifiers `io.onsite.agreement.status.updated`, `agreement_status_updated_fifo`, `AGREEMENT_STATUS_UPDATED` and `AgreementStatusUpdated` returned no matches. Its `claimId` use is therefore confirmed, but on the payment contract rather than `AgreementStatusUpdated`.

## AgreementStatusUpdated subscribers

### 1. `fg-gas-backend`: subscriber, but no field-specific use

Deployment configuration subscribes `gas__sqs__update_agreement_status_fifo.fifo` to `agreement_status_updated_fifo.fifo`: [`cdp-tenant-config/environments/prod/tenants/fg-gas-backend.json`](https://github.com/DEFRA/cdp-tenant-config/blob/e5240282a1608d9a7ec7e332eba518d99b909279/environments/prod/tenants/fg-gas-backend.json).

The source path is:

- the SQS subscriber saves the whole message to the inbox: [`src/grants/subscribers/agreement-status-updated.subscriber.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grants/subscribers/agreement-status-updated.subscriber.js);
- inbox processing selects `currentStatus`/`status`, `clientRef`/`caseRef`, and `workflowCode`/`code`, then passes the data object as `eventData`: [`src/grants/subscribers/inbox.subscriber.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grants/subscribers/inbox.subscriber.js);
- the accepted handler destructures `agreementNumber`, `date`, `startDate` and `endDate`; it does not read `claimId`: [`src/grants/use-cases/accept-agreement.use-case.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grants/use-cases/accept-agreement.use-case.js#L26-L48).

There are two generic propagation behaviours worth making explicit:

- the inbox persists the complete event rather than stripping unknown fields: [`src/grants/use-cases/save-inbox-message.use-case.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grants/use-cases/save-inbox-message.use-case.js);
- accepted-event audit detail includes the complete `eventData`, and the Admin detail mapper can expose a stored event payload verbatim: [`accept-agreement.use-case.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grants/use-cases/accept-agreement.use-case.js#L11-L23) and [`map-event-detail.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grant-admin/services/map-event-detail.js#L20-L44).

Those behaviours may retain, audit, log or display an extra `claimId`, but they do not identify it as a required field or use it to make a decision. Exact organisation searches for `payload.data.claimId`, `event.data.claimId`, `message.data.claimId`, `data?.claimId`, and a destructured `const { claimId` combined with `agreement.status.updated` all returned no results.

### 2. `farming-grants-agreements-pdf`: subscriber, field absent from code and contract

Deployment configuration subscribes `create_agreement_pdf_fifo.fifo` to `agreement_status_updated_fifo.fifo`: [`cdp-tenant-config/environments/prod/tenants/farming-grants-agreements-pdf.json`](https://github.com/DEFRA/cdp-tenant-config/blob/e5240282a1608d9a7ec7e332eba518d99b909279/environments/prod/tenants/farming-grants-agreements-pdf.json).

The handler checks the lifecycle event type, `data.status` and `data.agreementUrl`. Its processing path explicitly uses `agreementNumber`, `version`, `endDate`, `correlationId`, `sbi`, `frn`, `crn`, `agreementUrl` and `code`; it contains no `claimId` reference: [`src/common/helpers/sqs-message-processor.js`](https://github.com/DEFRA/farming-grants-agreements-pdf/blob/ec73dcf2a902afbf749dd85037ffff9b61f7211a/src/common/helpers/sqs-message-processor.js) and [`src/services/pdf-generator.js`](https://github.com/DEFRA/farming-grants-agreements-pdf/blob/ec73dcf2a902afbf749dd85037ffff9b61f7211a/src/services/pdf-generator.js#L53-L106).

The PDF consumer Pact describes `io.onsite.agreement.status.updated` without `claimId` and asserts PDF generation from the other fields: [`src/contracts/consumer/agreements-to-pdf.contract.test.js`](https://github.com/DEFRA/farming-grants-agreements-pdf/blob/ec73dcf2a902afbf749dd85037ffff9b61f7211a/src/contracts/consumer/agreements-to-pdf.contract.test.js#L48-L113).

A repository-wide, case-insensitive search for `claimId`, `claim_id`, `claim-id` and `ClaimId` in `farming-grants-agreements-pdf` returned no matches. The processor logs the complete payload and passes the data object to the PDF generator, but the downstream generator only reads the fields described above; this is not field-specific consumption.

## Infrastructure subscriber evidence

Authenticated search for the exact topic name `agreement_status_updated_fifo` found 44 files across nine repositories. The deployment-defining hits in private `DEFRA/cdp-tenant-config` are limited to three tenant files in each of `dev`, `test`, `perf-test`, `ext-test` and `prod`:

- topic owner: `farming-grants-agreements-api`;
- subscriber: `fg-gas-backend`;
- subscriber: `farming-grants-agreements-pdf`.

The production topic declaration is in [`environments/prod/tenants/farming-grants-agreements-api.json`](https://github.com/DEFRA/cdp-tenant-config/blob/e5240282a1608d9a7ec7e332eba518d99b909279/environments/prod/tenants/farming-grants-agreements-api.json). Its `agreement_status_updated_fifo` topic has `cross_account_allow_list: []`.

The remaining exact-name hits do not establish more deployed subscribers:

- [`DEFRA/cdp-app-config`](https://github.com/DEFRA/cdp-app-config) contains environment variables for the producer and GAS queue;
- [`farming-grants-agreements-api/compose/start-floci.sh`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/compose/start-floci.sh) creates local topic-to-PDF-queue wiring;
- [`grants-ui/compose/floci/gas/20-gas.sh`](https://github.com/DEFRA/grants-ui/blob/bb7dd0d4c3544e51d1a90ea6a2494e433270fd68/compose/floci/gas/20-gas.sh), [`fg-cw-backend/compose/floci/start.d/10-setup-resources.sh`](https://github.com/DEFRA/fg-cw-backend/blob/3ea092c0edea198c3efcecc59e47737fe5620644/compose/floci/start.d/10-setup-resources.sh), and [`fg-grants-core/compose/floci/ready.d/10-core-resources.sh`](https://github.com/DEFRA/fg-grants-core/blob/7007ade54cc661dd27cf4df448024c2b9ae0eeda/compose/floci/ready.d/10-core-resources.sh) repeat local integration wiring for GAS or PDF. They do not contain application handlers that read `claimId`.

These findings classify the two deployed queues as **confirmed event subscribers**, but source inspection is what allows them to be classified as **not confirmed `claimId` consumers**.

## Producer, contract and fixture hits

| Repository/path evidence                                                                                                                                                                                                                                                                                                                                                                                                                         | Classification        | Finding                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`farming-grants-agreements-api/src/api/agreement/helpers/accept-offer.js`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/src/api/agreement/helpers/accept-offer.js#L54-L152)                                                                                                                                                                                                             | Producer              | Reads `claimId` from the payment payload it has just built, then publishes that value in `data.claimId` on the lifecycle event. It does not consume an incoming lifecycle event.                                                                                                                                                                                              |
| [`farming-grants-agreements-api/src/api/common/helpers/send-grant-payment-event.js`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/src/api/common/helpers/send-grant-payment-event.js#L26-L51)                                                                                                                                                                                            | Producer              | Publishes the payment-creation event and returns the same producer-owned data to `acceptOffer`.                                                                                                                                                                                                                                                                               |
| [`farming-grants-agreements-api/docs/asyncapi-spec.js`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/docs/asyncapi-spec.js#L238-L255)                                                                                                                                                                                                                                                    | Contract/schema       | `AgreementStatusUpdatedPayload.data` lists agreement identity/status/date fields but not `claimId`; the generated example also omits it in [`schema-from-pact.js`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/docs/asyncapi-schemas/schema-from-pact.js#L263-L282). This does not establish a consumer requirement. |
| [`fg-gas-backend/src/agreements/services/integrations/create-outbox-messages.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/agreements/services/integrations/create-outbox-messages.js#L5-L51)                                                                                                                                                                                                   | Producer              | Copies `payment.paymentHubClaimId` to lifecycle `data.claimId` and publishes internally and to SNS.                                                                                                                                                                                                                                                                           |
| [`fg-gas-backend/scripts/publish-agreement-accepted-command.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/scripts/publish-agreement-accepted-command.js#L20-L58)                                                                                                                                                                                                                                    | Fixture/manual script | Contains `claimId: "R00000003"` in a hand-authored lifecycle payload. It is an input fixture for local execution, not application code reading the field.                                                                                                                                                                                                                     |
| [`fg-gas-backend/src/agreements/services/integrations/create-outbox-messages.test.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/agreements/services/integrations/create-outbox-messages.test.js) and [`test/agreements/invoke-agreement-action.test.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/test/agreements/invoke-agreement-action.test.js) | Producer tests        | Assert emitted payload shape. They do not prove a downstream consumer reads the field.                                                                                                                                                                                                                                                                                        |
| [`farming-grants-agreements-api/src/contracts/provider/agreements-gas.contract.test.js`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/src/contracts/provider/agreements-gas.contract.test.js)                                                                                                                                                                                            | Provider test/fixture | Mocks `claimId: "R00000001"` while producing an accepted event. This is provider-side evidence only.                                                                                                                                                                                                                                                                          |
| [`fg-grants-platform-admin/src/dev-ops/view-models/event-names.ts`](https://github.com/DEFRA/fg-grants-platform-admin/blob/912b05370c853d646ca4107f10e63dc911d0cb37/src/dev-ops/view-models/event-names.ts#L9-L21)                                                                                                                                                                                                                               | Generic tooling       | Maps the event type to a display name. A repository-wide `claimId`/`claim_id`/`claim-id`/`ClaimId` search returned no matches.                                                                                                                                                                                                                                                |
| [`farming-grants-docs`](https://github.com/DEFRA/farming-grants-docs)                                                                                                                                                                                                                                                                                                                                                                            | Documentation         | Describes the producer, topic and PDF/GAS flows. Documentation is not executable consumption.                                                                                                                                                                                                                                                                                 |

## Excluded `claimId` homonyms

The unqualified term is not reliable evidence of Payment Hub use.

- GAS Claim submission returns the inserted Mongo Claim record ID as `claimId`: [`src/grants/services/claims.service.js`](https://github.com/DEFRA/fg-gas-backend/blob/237ae665d68bfb13f62541ec465777fce6ecc1a8/src/grants/services/claims.service.js#L235-L247). This is an ObjectId string, not the `R########` Payment Hub identifier.
- The legacy Agreements helper [`src/api/agreement/helpers/invoice/claim-id.js`](https://github.com/DEFRA/farming-grants-agreements-api/blob/aa6c88354a8653848513f39ac9946560da99cf60/src/api/agreement/helpers/invoice/claim-id.js) reads `agreementData.claimId` or invoice state to create payment data. It is internal producer state, not data deserialised from `AgreementStatusUpdated`. It also explains false positives from the substring query `data.claimId` (`agreementData.claimId` contains that text).
- `claimId` plus `MessageConsumerPact` found [`ffc-demo-claim-service/test/contract/claim.test.js`](https://github.com/DEFRA/ffc-demo-claim-service/blob/67493a216b603fee5a7f770cc29e0e2f6c9a7aae/test/contract/claim.test.js) and [`ffc-demo-payment-service`](https://github.com/DEFRA/ffc-demo-payment-service/tree/fd2bb6ac3e5f7512867bb3d72695751fab6f886a/test/contract), whose example identifier is `MINE123`. Neither file mentions the Agreement lifecycle event or its topic; these are unrelated demo-domain claim IDs.

## Search ledger

Authenticated GitHub CLI access was active with `repo` and `read:org` scopes. GitHub GraphQL reported 2,194 repositories visible to that identity. Private hits in `cdp-app-config`, `cdp-tenant-config` and `farming-grants-docs` confirm that the search was not public-only, but repository visibility is still bounded by that identity's organisation/team access.

GitHub code search examines indexed files on repository default branches. The following searches were run with `org:DEFRA`:

| Search term(s)                                                                                | Result and classification                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"io.onsite.agreement.status.updated"`                                                        | 32 files in six repositories: Agreements API and GAS producer/tests; PDF consumer/config/contract; Admin type-label code; private docs and app config. No field-reading consumer.                                                |
| `"agreement_status_updated_fifo"`                                                             | 44 files in nine repositories. Deployment evidence resolves to producer plus GAS/PDF subscriptions; other hits are environment variables, local compose wiring, tests or docs.                                                   |
| `"AGREEMENT_STATUS_UPDATED"`                                                                  | 58 files in nine repositories (GitHub search matched case variants). Same producer/config/subscriber set; no additional handler.                                                                                                 |
| `"claimId" "io.onsite.agreement.status.updated"`                                              | Six files in two repositories, all producer code, producer tests or a manual script.                                                                                                                                             |
| `"claimId" "agreement_status_updated"`                                                        | One file, the Agreements API producer test.                                                                                                                                                                                      |
| `"claimId" "AgreementStatusUpdated"`                                                          | Two files, GAS producer and producer test, via `agreementStatusUpdatedTopicArn`.                                                                                                                                                 |
| `"data.claimId"`                                                                              | Four files in two repositories: legacy producer internals/tests and a GAS payment-output test. No lifecycle subscriber. Some matches are the substring `agreementData.claimId`.                                                  |
| `"payload.data.claimId"`, `"event.data.claimId"`, `"message.data.claimId"`, `"data?.claimId"` | No results.                                                                                                                                                                                                                      |
| `"const { claimId" "agreement.status.updated"`                                                | No results.                                                                                                                                                                                                                      |
| `"claimId" "MessageConsumerPact"`                                                             | Only unrelated `MINE123` demo Claim/Payment contracts.                                                                                                                                                                           |
| `"claimId" "create_agreement_pdf"`                                                            | No source consumer; a documentation page containing independent references was the only broader combined hit.                                                                                                                    |
| `"claimId" "sqs-message-processor"`                                                           | Agreements provider test/docs only; following the runtime handlers found no lifecycle `claimId` access.                                                                                                                          |
| `"claimId" "subscription" "agreement_status_updated"`                                         | The final authenticated query was rejected with GitHub HTTP 403 rate-limit exhaustion. Exact topic search and direct inspection of all matching tenant configuration had already identified the source-controlled subscriptions. |

Public web fallbacks using `site:github.com/DEFRA` for the exact event plus `claimId`, the exact FIFO topic plus `claimId`, Pact/schema/deserialiser combinations, and Terraform/SNS/SQS/subscription combinations returned no indexed DEFRA code. This is a limitation of public search-engine indexing, not independent proof of absence; the authenticated GitHub results above are the primary evidence.

## Repositories and searches with no relevant field use

- `DEFRA/farming-grants-agreements-pdf`: real lifecycle subscriber; repository-wide `claimId` variants returned no matches.
- `DEFRA/fg-grants-platform-admin`: event-name tooling; repository-wide `claimId` variants returned no matches.
- `DEFRA/grants-payment-service`: many confirmed Payment Hub `claimId` uses, but lifecycle event/topic variants returned no matches.
- `DEFRA/fg-gas-backend` Grants subscriber: lifecycle handler path inspected end to end; no field-specific read. Its other `claimId` occurrences are producer/payment code, fixtures, or Mongo Claim record IDs.
- `DEFRA/farming-grants-agreements-api`: producer and internal owner of the identifier; no incoming lifecycle consumer. Its PDF consumer contract and AsyncAPI schema do not require `claimId`.
- `DEFRA/grants-ui`, `DEFRA/fg-cw-backend`, and `DEFRA/fg-grants-core`: exact queue-name hits are local integration resource setup, not application consumption.
- `DEFRA/cdp-app-config`: environment values only.
- `DEFRA/cdp-tenant-config`: subscriptions only; no payload deserialisation.
- `DEFRA/farming-grants-docs`: documentation only.

## Residual uncertainty and decision use

The evidence supports treating the lifecycle `claimId` as having **no confirmed DEFRA field consumer**, while retaining a cutover gate for operational confirmation.

What this research does not establish:

- the actual SNS subscription list in every live AWS account at the time of cutover;
- manually created or separately managed subscriptions absent from `cdp-tenant-config`;
- consumers in repositories not visible to the authenticated identity, non-default branches, unindexed/generated artifacts, or deleted/history-only code;
- consumers outside the DEFRA GitHub organisation, including the implementation of an external Payment Hub;
- whether generic inbox, logging, Admin or audit retention of the whole event creates a data-retention dependency. It is observable propagation, but no field-specific dependency was found.

Accordingly:

1. **Source conclusion:** no DEFRA repository was found consuming Payment Hub `claimId` from `AgreementStatusUpdated`.
2. **Confirmed use:** Grants Payment Service consumes the identifier from the separate payment-creation contract and sends it to Payment Hub as `contractNumber`.
3. **Infrastructure conclusion:** the source-controlled production lifecycle subscriptions are GAS and the PDF service; neither reads the field.
4. **Operational gate:** immediately before removing the lifecycle field, confirm that the live SNS subscription inventory matches the two source-controlled subscriptions. If it matches, no additional consumer sign-off is required; investigate any mismatch before cutover.
