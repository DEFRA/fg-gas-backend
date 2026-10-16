import { agreementPaymentRequested } from "../src/agreements/events/agreement-payment-requested.event.js";
import {
  reportingAgreementCreated,
  reportingAgreementStatusChanged,
} from "../src/agreements/events/agreement-reporting.event.js";
import { agreementStatusUpdated } from "../src/agreements/events/agreement-status-updated.event.js";
import { toErrorKey } from "../src/common/buckets/error-key.js";
import { logger } from "../src/common/logger.js";
import { eventStatusValues } from "../src/events/event-status-values.js";
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
import { agreementCreatePayment } from "../src/payments/events/create-payment.event.js";

// Stamps every inbox and outbox row written before the writers stamped at
// insert. Named here so the declared types are complete however this is run.
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
};

// A row with a recorded error is stamped with its key as well.
const unstamped = {
  $or: [
    { eventType: null },
    { refs: null },
    { lastError: { $ne: null }, errorKey: null },
  ],
};

// The rows there were when this started. The version it replaces may still be
// writing while both run, and those rows are not this migration's to check.
const newestId = async (collection) => {
  const [newest] = await collection
    .find({}, { ...primary, projection: { _id: 1 }, sort: { _id: -1 } })
    .limit(1)
    .toArray();

  return newest?._id ?? null;
};

const upTo = (newest) => ({ _id: newest === null ? null : { $lte: newest } });

const errorKeyOf = ({ lastError }) =>
  lastError ? { errorKey: toErrorKey(lastError) } : {};

// Guarded by `unstamped`, so a row its writer stamped meanwhile is left alone.
const toWrite = (stampsOf) => (doc) => {
  const { refs, ...stamps } = stampsOf(doc);

  return {
    updateOne: {
      filter: { _id: doc._id, ...unstamped },
      update: {
        $set: { ...stamps, ...errorKeyOf(doc) },
        $addToSet: { refs: { $each: refs } },
      },
    },
  };
};

const stamp = async (collection, stampsOf, newest) => {
  const rows = collection.find(
    { ...unstamped, ...upTo(newest) },
    {
      ...primary,
      projection,
      sort: { _id: 1 },
      batchSize: BATCH_SIZE,
    },
  );
  let stamped = 0;
  let writes = [];

  for await (const doc of rows) {
    writes.push(toWrite(stampsOf)(doc));

    if (writes.length === BATCH_SIZE) {
      await collection.bulkWrite(writes, { ordered: false });
      stamped += writes.length;
      writes = [];
    }
  }

  if (writes.length > 0) {
    await collection.bulkWrite(writes, { ordered: false });
  }

  return stamped + writes.length;
};

const assertNone = async (collection, filter, problem) => {
  const count = await collection.countDocuments(filter, primary);

  if (count > 0) {
    throw new Error(`${count} ${collection.collectionName} rows ${problem}`);
  }
};

const outside = (values) => ({ $nin: [...values, null] });

const statuses = eventStatusValues.map(({ value }) => value);

const assertStamped = async (collection, newest) => {
  await assertNone(
    collection,
    { ...unstamped, ...upTo(newest) },
    "were left unstamped",
  );
  await assertNone(
    collection,
    { status: outside(statuses), ...upTo(newest) },
    "hold a status outside the listed values",
  );
};

export const up = async (db) => {
  const outbox = db.collection("outbox");
  const inbox = db.collection("inbox");

  logger.info(
    `Stamping event facts for ${declared.length} declared event types`,
  );

  const newestOutbox = await newestId(outbox);
  const newestInbox = await newestId(inbox);
  const outboxRows = await stamp(outbox, backfillOutboxStamps, newestOutbox);
  const inboxRows = await stamp(inbox, backfillInboxStamps, newestInbox);

  logger.info(`Stamped ${outboxRows} outbox rows and ${inboxRows} inbox rows`);

  await assertStamped(outbox, newestOutbox);
  await assertStamped(inbox, newestInbox);
};
