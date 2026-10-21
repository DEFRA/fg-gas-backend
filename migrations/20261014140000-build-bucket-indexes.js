import { agreementPaymentRequested } from "../src/agreements/events/agreement-payment-requested.event.js";
import {
  reportingAgreementCreated,
  reportingAgreementStatusChanged,
} from "../src/agreements/events/agreement-reporting.event.js";
import { agreementStatusUpdated } from "../src/agreements/events/agreement-status-updated.event.js";
import { ensureIndexes } from "../src/common/buckets/indexes.js";
import { logger } from "../src/common/logger.js";
import { inboxBucket } from "../src/events/buckets/inbox.bucket.js";
import { outboxBucket } from "../src/events/buckets/outbox.bucket.js";
import { applicationsBucket } from "../src/grants/buckets/applications.bucket.js";
import { caseCreate } from "../src/grants/commands/create-new-case.command.js";
import { caseUpdateStatus } from "../src/grants/commands/update-case-status.command.js";
import { applicationCreated } from "../src/grants/events/application-created.event.js";
import { applicationStatusUpdated } from "../src/grants/events/application-status-updated.event.js";
import { claimPaymentRequested } from "../src/grants/events/claim-payment-requested.event.js";
import { agreementCreate } from "../src/grants/events/create-agreement.command.js";
import {
  caseStatusUpdated,
  configVersionUpdated,
} from "../src/grants/events/inbound-event-types.js";
import { agreementStatusUpdate } from "../src/grants/events/update-agreement-status.command.js";
import { agreementCreatePayment } from "../src/payments/events/create-payment.event.js";

// Built after the backfills, so they do not maintain the new indexes. The
// event types are named here so the box buckets are whole however this is run.
const declared = [
  agreementCreate,
  agreementCreatePayment,
  agreementPaymentRequested,
  agreementStatusUpdate,
  agreementStatusUpdated,
  applicationCreated,
  applicationStatusUpdated,
  caseCreate,
  caseStatusUpdated,
  caseUpdateStatus,
  claimPaymentRequested,
  configVersionUpdated,
  reportingAgreementCreated,
  reportingAgreementStatusChanged,
];

const factories = [outboxBucket, inboxBucket, applicationsBucket];

export const up = async (db) => {
  logger.info(
    `Building bucket indexes for ${factories.length} buckets over ${declared.length} declared event types`,
  );

  for (const factory of factories) {
    await ensureIndexes(db, factory());
  }
};
