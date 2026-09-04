import { ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import {
  BREAKDOWN_TYPE_FIELDS,
  breakdownStages,
  toBreakdownGroups,
} from "../../common/event-breakdown.js";
import { toSourceFacets } from "../../common/event-facets.js";
import { buildEventListFilter } from "../../common/event-list-filter.js";
import {
  PARK_FROM_STATUS,
  UNPARK_FROM_STATUS,
  parkUpdate,
  unparkUpdate,
} from "../../common/event-park.js";
import {
  REDRIVE_FROM_STATUS,
  redriveUpdate,
} from "../../common/event-redrive.js";
import {
  claimExpiredAttempt,
  claimExpiredError,
  pushAttemptUpdate,
} from "../../common/last-error.js";
import { db } from "../../common/mongo-client.js";
import { paginate } from "../../common/paginate.js";
import {
  statusGroupStage,
  toStatusCounts,
} from "../../common/status-counts.js";
import { Inbox, InboxStatus } from "../models/inbox.js";

const collection = "inbox";
const MAX_RETRIES = config.inbox.inboxMaxRetries;
const NUMBER_OF_RECORDS = config.inbox.inboxClaimMaxRecords;
const EXPIRES_IN_MS = config.inbox.inboxExpiresMs;

// Generic inbox/outbox fields plus `traceparent` (the log-correlation id the
// list turns into a trace link). Never `event`, `event.data`, `claimedBy`, or
// `publicationDate` (rewritten on every save - see models/inbox.js:25).
const listProjection = {
  _id: 1,
  messageId: 1,
  type: 1,
  source: 1,
  status: 1,
  completionAttempts: 1,
  traceparent: 1,
  eventTime: 1,
  lastResubmissionDate: 1,
  completionDate: 1,
  lastError: 1,
  segregationRef: 1,
  // Operator state, projected onto every list row: the frontend renders a
  // "parked" badge with its reason, and `lastRedrive` says who last redrove.
  parked: 1,
  lastRedrive: 1,
};

// eventTime is an ISO string on every inbox document (models/inbox.js:38),
// so it round-trips through the cursor unchanged.
const listCodecs = {
  eventTime: {
    encode: (value) => value ?? null,
    decode: (value) => value ?? null,
  },
  _id: {
    encode: (id) => id.toString(),
    decode: (hex) => ObjectId.createFromHexString(hex),
  },
};

// Extracted so `findPage` stays inside the configured complexity max of 4.
//
// `eventTime` is the box's sort key AND its time-range field: it is a
// Z-normalised ISO string on every inbox document (models/inbox.js and
// migrations/20260901130000-normalise-event-sort-keys.js), so a string bound
// compares chronologically and needs no coercion.
const listFilter = ({ status, q, error, from, to }) =>
  buildEventListFilter({
    status,
    q,
    error,
    from,
    to,
    eventIdField: "messageId",
    traceparentField: "traceparent",
    rangeField: "eventTime",
    rangeIsDate: false,
  });

const listSort = { eventTime: -1, _id: -1 };

export const deadLetterEvent = async (event) => {
  const results = await db.collection(collection).updateOne(
    {
      _id: event._id,
    },
    {
      $set: {
        status: InboxStatus.DEAD_LETTER,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    },
  );
  return results;
};

export const findNextMessage = async (lockIds) => {
  const doc = await db.collection(collection).findOne(
    {
      status: { $eq: InboxStatus.PUBLISHED },
      claimedBy: { $eq: null },
      completionAttempts: { $lt: MAX_RETRIES },
      segregationRef: { $nin: lockIds },
    },
    { sort: { eventTime: 1 } },
  );
  return doc;
};

export const claimEvents = async (
  claimedBy,
  segregationRef,
  numRecords = NUMBER_OF_RECORDS,
) => {
  const docs = [];
  for (let i = 0; i < numRecords; i++) {
    const document = await db.collection(collection).findOneAndUpdate(
      {
        status: { $eq: InboxStatus.PUBLISHED },
        claimedBy: { $eq: null },
        completionAttempts: { $lt: MAX_RETRIES },
        segregationRef,
      },
      {
        $set: {
          status: InboxStatus.PROCESSING,
          claimedBy,
          claimedAt: new Date(),
          claimExpiresAt: new Date(Date.now() + EXPIRES_IN_MS),
        },
      },
      { sort: { eventTime: 1 }, returnDocument: "after" },
    );

    docs.push(document);
  }

  const documents = docs.filter((d) => d !== null);
  return documents.map((doc) => Inbox.fromDocument(doc));
};

export const processExpiredEvents = async () => {
  await db.collection(collection).updateMany(
    {
      claimExpiresAt: { $lt: new Date() },
      // PARKED is excluded as well as the two terminal statuses: an
      // operator parked this row on purpose and no sweep may move it.
      status: {
        $nin: [
          InboxStatus.DEAD_LETTER,
          InboxStatus.COMPLETED,
          InboxStatus.PARKED,
        ],
      },
    },
    {
      $set: {
        status: InboxStatus.FAILED,
        // Nothing threw here - the claim simply outlived its holder - so the
        // sweep records itself as the reason.
        lastError: claimExpiredError(),
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
      // A sweep, not a model save: this rewrites many rows at once and never
      // loads an Inbox/Outbox, so the cap is applied by Mongo. `$slice: -10`
      // on the `$push` keeps the ten most recent entries per row.
      $push: pushAttemptUpdate(claimExpiredAttempt()),
      // An expired claim IS a failed attempt, so it is counted in the same
      // operation that records it - see ATTEMPT ARITHMETIC in models/inbox.js.
      $inc: { completionAttempts: 1 },
    },
  );
};

export const updateDeadEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      completionAttempts: { $gte: MAX_RETRIES },
      // `$nin`, not `$ne`: `$ne: DEAD_LETTER` matched PARKED rows too and
      // would have dragged poison an operator parked straight back into
      // DEAD_LETTER on the next tick.
      status: { $nin: [InboxStatus.DEAD_LETTER, InboxStatus.PARKED] },
    },
    {
      $set: {
        status: InboxStatus.DEAD_LETTER,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    },
  );
  return results;
};

// Move failed events to resubmitted status
export const updateFailedEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      // Selects FAILED alone, so PARKED is out of scope by construction.
      status: InboxStatus.FAILED,
    },
    {
      $set: {
        status: InboxStatus.RESUBMITTED,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    },
  );
  return results;
};

// Move resubmitted events to published status
export const updateResubmittedEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      status: InboxStatus.RESUBMITTED,
    },
    {
      $set: {
        status: InboxStatus.PUBLISHED,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
      // No `$inc` here. This is a state transition, not an attempt: the
      // counter is raised by `markAsFailed` when an attempt actually fails.
      // Incrementing here counted attempts GRANTED, which let the dead-letter
      // sweep below kill a row at the cap before its final attempt ran - the
      // "5/5 with four history entries" bug.
    },
  );
  return results;
};

export const insertMany = async (events, session) => {
  return db.collection(collection).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};

export const findByMessageId = async (messageId) => {
  const doc = db.collection(collection).findOne({ messageId });
  return doc;
};

export const insertOne = async (inbox, session) => {
  return db.collection(collection).insertOne(inbox.toDocument(), { session });
};

export const update = async (inbox) => {
  const document = inbox.toDocument();
  const { _id, ...updateDoc } = document;

  return db.collection(collection).updateOne({ _id }, { $set: updateDoc });
};

export const findPage = async ({
  cursor,
  direction = "forward",
  pageSize = 20,
  status,
  q,
  error,
  from,
  to,
} = {}) =>
  paginate(db.collection(collection), {
    filter: listFilter({ status, q, error, from, to }),
    sort: listSort,
    codecs: listCodecs,
    cursor,
    direction,
    pageSize,
    project: listProjection,
  });

// How many rows sit in each status for the same selection the list would
// show, minus the cursor: the counts describe the whole filtered box, not one
// page. `status` is deliberately not a parameter - grouping BY status is the
// point. See common/status-counts.js for the accepted cost of the scan.
export const countByStatus = async (filter = {}) =>
  toStatusCounts(
    await db
      .collection(collection)
      .aggregate([{ $match: listFilter(filter) }, statusGroupStage()])
      .toArray(),
  );

// This source's contribution to the faceted counts: the status split for
// everything the operator asked for - see common/event-facets.js.
export const countFacets = async (filter = {}) =>
  toSourceFacets(
    await db
      .collection(collection)
      .aggregate([{ $match: listFilter(filter) }, statusGroupStage()])
      .toArray(),
  );

const toId = (id) => ObjectId.createFromHexString(id);

// The whole stored document minus the claim token - the detail view is the one
// place allowed to read the `event` payload, and only one row at a time.
// `claimedBy` is a live claim token and is never exposed.
export const findById = (id) =>
  db
    .collection(collection)
    .findOne({ _id: toId(id) }, { projection: { claimedBy: 0 } });

// Only used to tell a 404 from a 409 after a redrive matched nothing.
export const findStatusById = async (id) => {
  const doc = await db
    .collection(collection)
    .findOne({ _id: toId(id) }, { projection: { status: 1 } });

  return doc ? doc.status : null;
};

// A single conditional update: the DEAD_LETTER filter is the precondition, so
// a row that changed status between the read and the write simply matches
// nothing and the caller reports a 409 rather than clobbering it. Answers with
// the updated document in the list projection.
export const redriveById = (id, { by } = {}) =>
  db
    .collection(collection)
    .findOneAndUpdate(
      { _id: toId(id), status: REDRIVE_FROM_STATUS },
      redriveUpdate(InboxStatus.RESUBMITTED, { by }),
      { returnDocument: "after", projection: listProjection },
    );

// Park and unpark, the same single conditional update the redrive is: the
// expected status IS the precondition, so a concurrent change matches nothing
// and the caller reports a 409 rather than clobbering it.
//
// PARKED is terminal for the pollers - see the PARKED exclusions in the claim,
// claim-expiry and dead-letter filters above, and the tests that run those
// real filters against a parked document.
export const parkById = (id, { reason, by } = {}) =>
  db
    .collection(collection)
    .findOneAndUpdate(
      { _id: toId(id), status: PARK_FROM_STATUS },
      parkUpdate({ reason, by }),
      { returnDocument: "after", projection: listProjection },
    );

export const unparkById = (id) =>
  db
    .collection(collection)
    .findOneAndUpdate(
      { _id: toId(id), status: UNPARK_FROM_STATUS },
      unparkUpdate(),
      {
        returnDocument: "after",
        projection: listProjection,
      },
    );

// How the dead letters in this box group by (failure message, event type).
// Scoped to DEAD_LETTER here rather than by the caller so the breakdown can
// never accidentally count a PARKED or a still-retrying row.
export const breakdown = async (filter = {}) =>
  toBreakdownGroups(
    await db
      .collection(collection)
      .aggregate(
        breakdownStages({
          filter: listFilter({ ...filter, status: REDRIVE_FROM_STATUS }),
          typeField: BREAKDOWN_TYPE_FIELDS.inbox,
          sortKey: "eventTime",
        }),
      )
      .toArray(),
  );

// The ids of the dead letters a redrive-by-filter would act on, newest first
// and capped. Ids only, and collected BEFORE any redrive runs: redriving moves
// a row out of DEAD_LETTER, so a skip/cursor walk over a shrinking result set
// would silently skip rows.
export const findDeadLetterIds = async (filter = {}, limit = 0) =>
  (
    await db
      .collection(collection)
      .find(listFilter({ ...filter, status: REDRIVE_FROM_STATUS }), {
        projection: { _id: 1 },
        sort: listSort,
        limit,
      })
      .toArray()
  ).map((doc) => doc._id.toString());
