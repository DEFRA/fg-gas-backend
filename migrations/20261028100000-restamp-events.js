import { agreementPaymentRequested } from "../src/agreements/events/agreement-payment-requested.event.js";
import {
  reportingAgreementCreated,
  reportingAgreementStatusChanged,
} from "../src/agreements/events/agreement-reporting.event.js";
import { agreementStatusUpdated } from "../src/agreements/events/agreement-status-updated.event.js";
import { logger } from "../src/common/logger.js";
import { withErrorKey } from "../src/events/last-error.js";
import {
  backfillInboxStamps,
  backfillOutboxStamps,
} from "../src/events/stamps.js";
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
import {
  agreementCreatePayment,
  applicationRefsOfPayment,
} from "../src/payments/events/create-payment.event.js";
import { Payment } from "../src/payments/models/payment.js";

// Stamps the inbox and outbox rows the FGP-1500 stamp left behind: those the
// replaced version wrote while it ran, and, where it ran before case links
// were stamped, the case links of the types that carry them. It has no _id
// cutoff and writes only what a row lacks, so running it again changes nothing.
// A row still unstamped after it is counted and logged, never failing the start.
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

const caseLinked = [caseCreate, caseStatusUpdated, caseUpdateStatus].map(
  ({ name }) => name,
);

const BATCH_SIZE = 1000;

const primary = { readPreference: "primary" };

const projection = {
  target: 1,
  segregationRef: 1,
  messageId: 1,
  traceparent: 1,
  event: 1,
  originalPayload: 1,
  lastError: 1,
  eventType: 1,
  refs: 1,
  errorKey: 1,
};

const unstamped = [
  { eventType: null },
  { refs: null },
  { lastError: { $ne: null }, errorKey: null },
];

// Every case link starts "case:"; ";" is the character after ":".
const withoutCaseLink = {
  eventType: { $in: caseLinked },
  refs: { $not: { $elemMatch: { $gte: "case:", $lt: "case;" } } },
};

const toRestamp = { $or: [...unstamped, withoutCaseLink] };

const isMissing = (value) => value === null || value === undefined;

const updateOne = (filter, update) => ({ updateOne: { filter, update } });

// Each write holds only while what it was worked out from is still on the row,
// so a stamp a live writer adds meanwhile is never overwritten.
const eventTypeWrites = (doc, eventType) =>
  isMissing(doc.eventType)
    ? [updateOne({ _id: doc._id, eventType: null }, { $set: { eventType } })]
    : [];

const refsWrites = (doc, refs) => {
  if (!Array.isArray(doc.refs)) {
    return [
      updateOne({ _id: doc._id, refs: doc.refs ?? null }, { $set: { refs } }),
    ];
  }

  const added = refs.filter((ref) => !doc.refs.includes(ref));

  return added.length > 0
    ? [updateOne({ _id: doc._id }, { $addToSet: { refs: { $each: added } } })]
    : [];
};

const errorKeyWrites = ({ _id, lastError, errorKey }) =>
  lastError && isMissing(errorKey)
    ? [
        updateOne(
          { _id, lastError, errorKey: null },
          { $set: { errorKey: withErrorKey(lastError).errorKey } },
        ),
      ]
    : [];

const claimIdOf = (doc) => (doc.originalPayload ?? doc.event)?.data?.claimId;

const isPayment = (doc) =>
  backfillOutboxStamps(doc).eventType === agreementCreatePayment.name;

const applicationRefsFrom = (stored) => {
  try {
    return applicationRefsOfPayment(new Payment(stored));
  } catch (error) {
    if (!error.isBoom) {
      throw error;
    }

    return [];
  }
};

// A payment's message carries no grant code, so as when it was published, its
// application link comes from the Payment.
const outboxStampsFor = (db) => async (docs) => {
  const claimIds = docs
    .filter(isPayment)
    .map(claimIdOf)
    .filter((claimId) => typeof claimId === "string");

  const stored =
    claimIds.length > 0
      ? await db
          .collection("payments__payments")
          .find({ paymentHubClaimId: { $in: claimIds } }, primary)
          .toArray()
      : [];

  const refsOf = new Map(
    stored.map((doc) => [doc.paymentHubClaimId, applicationRefsFrom(doc)]),
  );

  return (doc) =>
    backfillOutboxStamps(doc, isPayment(doc) ? refsOf.get(claimIdOf(doc)) : []);
};

const inboxStampsFor = async () => backfillInboxStamps;

// Only what a row lacks is written: a stamp already there is never changed.
const writesFor = (stampsOf) => (doc) => {
  const { eventType, refs } = stampsOf(doc);

  return [
    ...eventTypeWrites(doc, eventType),
    ...refsWrites(doc, refs),
    ...errorKeyWrites(doc),
  ];
};

const readBatch = (collection, after) =>
  collection
    .find(
      { ...toRestamp, ...(after === null ? {} : { _id: { $gt: after } }) },
      { ...primary, projection, sort: { _id: 1 }, limit: BATCH_SIZE },
    )
    .toArray();

// One batch at a time, each after the last row of the one before.
const stampFrom = async (collection, stampsFor, after, stamped) => {
  const docs = await readBatch(collection, after);

  if (docs.length === 0) {
    return stamped;
  }

  const changed = docs
    .map(writesFor(await stampsFor(docs)))
    .filter((writes) => writes.length);

  if (changed.length > 0) {
    await collection.bulkWrite(changed.flat(), { ordered: false });
  }

  return stampFrom(
    collection,
    stampsFor,
    docs.at(-1)._id,
    stamped + changed.length,
  );
};

const stamp = (collection, stampsFor) =>
  stampFrom(collection, stampsFor, null, 0);

const reportUnstamped = async (collection) => {
  const count = await collection.countDocuments({ $or: unstamped }, primary);

  if (count > 0) {
    logger.warn(
      `${count} ${collection.collectionName} rows were left unstamped`,
    );
  }
};

export const up = async (db) => {
  const outbox = db.collection("outbox");
  const inbox = db.collection("inbox");

  logger.info(
    `Re-stamping event facts for ${declared.length} declared event types`,
  );

  const outboxRows = await stamp(outbox, outboxStampsFor(db));
  const inboxRows = await stamp(inbox, inboxStampsFor);

  logger.info(
    `Re-stamped ${outboxRows} outbox rows and ${inboxRows} inbox rows`,
  );

  await reportUnstamped(outbox);
  await reportUnstamped(inbox);
};
