# Agreement PDF recovery runbook

## Purpose

Recover three production `AgreementStatusUpdated` events whose GAS-side processing completed but whose external SNS Outbox publications dead-lettered before reaching the Agreement PDF service.

The recovery must be rehearsed in lower environments before production.

## Confirmed cause and scope

GAS `1.212.0` created both an internal and an SNS Outbox record for each Agreement lifecycle event. For the three affected accepted events, Admin shows:

- a completed GAS Outbox record for internal delivery;
- a completed GAS Inbox record, confirming GAS processed acceptance;
- a dead-letter GAS Outbox record targeting the legacy Agreements-owned topic.

Only the three accepted external Outbox records require recovery. Two offered dead letters require no recovery because GAS processed them internally and the PDF service does not generate PDFs for offered Agreements.

## Safety controls

The migration matches only records with all of these properties:

- one of the three confirmed CloudEvent IDs;
- `status: DEAD_LETTER`;
- `event.type: io.onsite.agreement.status.updated`;
- `event.data.status: accepted`;
- the current environment's legacy Agreement-status topic ARN.

It derives the legacy and GAS-owned ARNs from `GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN`, so the same migration can be rehearsed safely in lower environments. It changes only `target` and leaves redrive to Grant Admin.

## Lower-environment rehearsal

Perform the rehearsal in each required lower environment before deploying the migration there. Migrations run once, so create the synthetic records before deployment.

### Prepare synthetic data

For each recovery event ID, create:

1. A completed Inbox record with:
   - `messageId` equal to the recovery event ID;
   - the same event in `event`;
   - `source: AS`;
   - `status: COMPLETED`.
2. A dead-letter Outbox record with:
   - the same event ID and payload;
   - synthetic lower-environment Agreement and customer data;
   - `status: DEAD_LETTER`;
   - `event.data.status: accepted`;
   - `target` set to that environment's legacy Agreement-status topic ARN.

The synthetic event must reference an Agreement URL that exists in that environment and is allowed by the PDF service. Never copy production payload data into a lower environment.

A completed historical internal Outbox record is optional; it is not required for duplicate suppression. The completed Inbox record is required.

### Rehearse

1. Record the lower-environment Application and Agreement state.
2. Deploy the migration.
3. Confirm the migration changed only the synthetic Outbox targets to the environment's GAS-owned topic.
4. Redrive one Outbox record through Grant Admin.
5. Confirm the Outbox reaches `COMPLETED`.
6. Confirm GAS creates no second Inbox record for the event ID and changes no Application, Agreement, Payment or Caseworking state.
7. Confirm the PDF service logs a successful S3 upload and the PDF is accessible.
8. Repeat for the remaining synthetic records.
9. Remove the synthetic records and generated PDFs according to lower-environment data-cleanup procedures.

Do not rely on Outbox completion alone: the PDF service currently logs and consumes some generation/upload failures. Verify the successful S3 upload and resulting document explicitly.

## Production recovery

Before deployment, confirm each production event has a completed GAS Inbox counterpart and that its failed Outbox copy still matches every migration safety control.

1. Deploy the tested migration to production.
2. Confirm its log reports `matchedCount: 3`, `modifiedCount: 3`, and `expectedCount: 3`.
3. Open each affected Outbox record and confirm its topic is `gas__sns__agreement_status_updated_fifo.fifo`.
4. Redrive the records individually, waiting for each to complete before continuing.
5. For each event, confirm:
   - the retargeted Outbox record reaches `COMPLETED`;
   - GAS creates no duplicate Inbox record;
   - no new GAS dead letter appears;
   - the PDF service logs a successful S3 upload;
   - the Agreement PDF is accessible through the expected user journey.

If the migration matches fewer or more than three production records, do not redrive anything. Recheck the event IDs, payload status and existing targets.
