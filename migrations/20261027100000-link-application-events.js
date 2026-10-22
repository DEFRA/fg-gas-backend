import { agreementPaymentRequested } from "../src/agreements/events/agreement-payment-requested.event.js";
import {
  reportingAgreementCreated,
  reportingAgreementStatusChanged,
} from "../src/agreements/events/agreement-reporting.event.js";
import { agreementStatusUpdated } from "../src/agreements/events/agreement-status-updated.event.js";
import { toRefs } from "../src/common/buckets/refs.js";
import { logger } from "../src/common/logger.js";
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

// Links the stored application events to their application within its grant,
// from the envelope as its writer wrote it, or for a payment from the Payment.
// It only adds the link, so running it again changes nothing. A row it cannot
// link is counted and logged, never failing the start. Named here so the
// declared types are complete however this is run.
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

const linkedTypes = {
  outbox: [
    agreementCreate,
    agreementCreatePayment,
    agreementStatusUpdate,
    agreementStatusUpdated,
    applicationCreated,
    applicationStatusUpdated,
    caseCreate,
    caseUpdateStatus,
    claimPaymentRequested,
  ].map(({ name }) => name),
  inbox: [agreementStatusUpdated, caseStatusUpdated].map(({ name }) => name),
};

const BATCH_SIZE = 1000;
const IDS_LOGGED = 10;

const NO_CODE = "no grant code or reference in the envelope";
const UNSTAMPED = "refs never stamped";
const NO_PAYMENT = "payment not found";
const BAD_PAYMENT = "payment not valid";

const primary = { readPreference: "primary" };

const projection = {
  eventType: 1,
  target: 1,
  segregationRef: 1,
  traceparent: 1,
  event: 1,
  originalPayload: 1,
};

// Every link starts "application:"; ";" is the character after ":". A row
// whose refs are not an array was never stamped: it is counted, not linked.
const unlinked = (names) => ({
  eventType: { $in: names },
  refs: {
    $type: "array",
    $not: { $elemMatch: { $gte: "application:", $lt: "application;" } },
  },
});

const unstamped = (names) => ({
  eventType: { $in: names },
  refs: { $not: { $type: "array" } },
});

const isLink = (ref) => ref.startsWith("application:");

const envelopeOf = (doc) => doc.originalPayload ?? doc.event ?? {};

const readBatch = (collection, names, after) =>
  collection
    .find(
      {
        ...unlinked(names),
        ...(after === null ? {} : { _id: { $gt: after } }),
      },
      { ...primary, projection, sort: { _id: 1 }, limit: BATCH_SIZE },
    )
    .toArray();

const claimIdOf = (doc) => envelopeOf(doc).data?.claimId;

const paymentsFor = async (db, docs) => {
  const claimIds = docs
    .filter(({ eventType }) => eventType === agreementCreatePayment.name)
    .map(claimIdOf)
    .filter((claimId) => typeof claimId === "string");

  if (claimIds.length === 0) {
    return new Map();
  }

  const stored = await db
    .collection("payments__payments")
    .find({ paymentHubClaimId: { $in: claimIds } }, primary)
    .toArray();

  return new Map(stored.map((doc) => [doc.paymentHubClaimId, doc]));
};

const fromPayment = (stored) => {
  if (!stored) {
    return { reason: NO_PAYMENT };
  }

  let payment;

  try {
    payment = new Payment(stored);
  } catch (error) {
    if (!error.isBoom) {
      throw error;
    }

    return { reason: BAD_PAYMENT };
  }

  if (payment.applicationOf() === null) {
    return { agreementPayment: true };
  }

  const links = toRefs(applicationRefsOfPayment(payment)).filter(isLink);

  return links.length > 0 ? { links } : { reason: NO_CODE };
};

const fromEnvelope = (stampsOf, doc) => {
  const links = stampsOf(doc).refs.filter(isLink);

  return links.length > 0 ? { links } : { reason: NO_CODE };
};

const linkOf = (stampsOf, stored) => (doc) =>
  doc.eventType === agreementCreatePayment.name
    ? fromPayment(stored.get(claimIdOf(doc)))
    : fromEnvelope(stampsOf, doc);

const toWrite = ({ _id }, links) => ({
  updateOne: {
    filter: { _id },
    update: { $addToSet: { refs: { $each: links } } },
  },
});

const tally = (totals, doc, { links, reason, agreementPayment }) => {
  if (links) {
    totals.linked += 1;
  } else if (agreementPayment) {
    totals.agreementPayments += 1;
  } else {
    const found = (totals.unlinked[reason] ??= { byType: {}, ids: [] });
    found.byType[doc.eventType] = (found.byType[doc.eventType] ?? 0) + 1;

    if (found.ids.length < IDS_LOGGED) {
      found.ids.push(doc._id.toString());
    }
  }

  return totals;
};

const linkBatch = async (db, collection, stampsOf, docs, totals) => {
  const linkFor = linkOf(stampsOf, await paymentsFor(db, docs));
  const results = docs.map((doc) => [doc, linkFor(doc)]);
  const writes = results
    .filter(([, { links }]) => links)
    .map(([doc, { links }]) => toWrite(doc, links));

  if (writes.length > 0) {
    await collection.bulkWrite(writes, { ordered: false });
  }

  return results.reduce(
    (sum, [doc, result]) => tally(sum, doc, result),
    totals,
  );
};

const linkFrom = async (db, box, stampsOf, after, totals) => {
  const collection = db.collection(box);
  const docs = await readBatch(collection, linkedTypes[box], after);

  if (docs.length === 0) {
    return totals;
  }

  return linkFrom(
    db,
    box,
    stampsOf,
    docs.at(-1)._id,
    await linkBatch(db, collection, stampsOf, docs, totals),
  );
};

const link = (db, box, stampsOf) =>
  linkFrom(db, box, stampsOf, null, {
    linked: 0,
    agreementPayments: 0,
    unlinked: {},
  });

const countOf = (byType) =>
  Object.values(byType).reduce((sum, count) => sum + count, 0);

const byTypeOf = (byType) =>
  Object.entries(byType)
    .map(([eventType, count]) => `${eventType} ${count}`)
    .join(", ");

const reportUnstamped = async (db, box) => {
  const collection = db.collection(box);
  const filter = unstamped(linkedTypes[box]);
  const count = await collection.countDocuments(filter, primary);

  if (count > 0) {
    const ids = await collection
      .find(filter, { ...primary, projection: { _id: 1 }, limit: IDS_LOGGED })
      .toArray();

    logger.warn(
      `${count} ${box} rows not linked (${UNSTAMPED}); first ids ${ids.map(({ _id }) => _id.toString()).join(", ")}`,
    );
  }
};

const report = (box, { agreementPayments, unlinked }) => {
  if (agreementPayments > 0) {
    logger.info(
      `${agreementPayments} ${box} rows are Agreement payments, linked to no application`,
    );
  }

  for (const [reason, { byType, ids }] of Object.entries(unlinked)) {
    logger.warn(
      `${countOf(byType)} ${box} rows not linked (${reason}): ${byTypeOf(byType)}; first ids ${ids.join(", ")}`,
    );
  }
};

export const up = async (db) => {
  logger.info(
    `Linking application events for ${declared.length} declared event types`,
  );

  const outbox = await link(db, "outbox", backfillOutboxStamps);
  const inbox = await link(db, "inbox", backfillInboxStamps);

  logger.info(
    `Linked ${outbox.linked} outbox rows and ${inbox.linked} inbox rows to their applications`,
  );
  report("outbox", outbox);
  report("inbox", inbox);
  await reportUnstamped(db, "outbox");
  await reportUnstamped(db, "inbox");
};
