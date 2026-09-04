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
  REDRIVE_FROM_STATUS,
  redriveUpdate,
} from "../../common/event-redrive.js";
import {
  claimExpiredAttempt,
  claimExpiredError,
  pushAttemptUpdate,
} from "../../common/last-error.js";
import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { paginate } from "../../common/paginate.js";
import { statusGroupStage } from "../../common/status-counts.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const collection = "outbox";

const MAX_RETRIES = config.outbox.outboxMaxRetries;
const EXPIRES_IN_MS = config.outbox.outboxExpiresMs;
const NUMBER_OF_RECORDS = config.outbox.outboxClaimMaxRecords;

// Generic outbox fields plus the handful of event subfields the list derives
// its id, type and trace link from. Never the full `event`, `event.data`, or
// `claimedBy`.
const listProjection = {
  _id: 1,
  target: 1,
  "event.id": 1,
  "event.type": 1,
  "event.traceparent": 1,
  "event.audit.entities.entity": 1,
  "event.audit.entities.action": 1,
  status: 1,
  completionAttempts: 1,
  publicationDate: 1,
  lastResubmissionDate: 1,
  completionDate: 1,
  lastError: 1,
  segregationRef: 1,
  // Operator state, projected onto every list row: `lastRedrive` says who last
  // redrove it.
  lastRedrive: 1,
};

// publicationDate is a native Date on every outbox document
// (models/outbox.js:37), so the cursor carries it as an ISO string.
const listCodecs = {
  publicationDate: {
    encode: (value) => (value instanceof Date ? value.toISOString() : value),
    decode: (value) => new Date(value),
  },
  _id: {
    encode: (id) => id.toString(),
    decode: (hex) => ObjectId.createFromHexString(hex),
  },
};

// `publicationDate` is the box's sort key AND its time-range field, and it is
// a BSON Date on every outbox document (models/outbox.js), so an ISO bound is
// coerced to a Date - a string bound would silently match nothing.
const listFilter = ({ status, q, error, from, to }) =>
  buildEventListFilter({
    status,
    q,
    error,
    from,
    to,
    eventIdField: "event.id",
    traceparentField: "event.traceparent",
    rangeField: "publicationDate",
    rangeIsDate: true,
  });

const listSort = { publicationDate: -1, _id: -1 };

export const deadLetterEvent = async (event) => {
  const results = await db.collection(collection).updateOne(
    {
      _id: event._id,
    },
    {
      $set: {
        status: OutboxStatus.DEAD_LETTER,
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
      status: OutboxStatus.PUBLISHED,
      claimedBy: null,
      completionAttempts: { $lt: MAX_RETRIES },
      segregationRef: { $nin: lockIds },
    },
    { sort: { publicationDate: 1 } },
  );
  return doc;
};

export const claimEvents = async (claimedBy, segregationRef) => {
  const docs = [];

  logger.info(
    `Outbox repository claim events with segregationRef: ${segregationRef}`,
  );

  for (let i = 0; i < NUMBER_OF_RECORDS; i++) {
    const doc = await db.collection(collection).findOneAndUpdate(
      {
        status: {
          $eq: OutboxStatus.PUBLISHED,
        },
        claimedBy: {
          $eq: null,
        },
        completionAttempts: {
          $lt: MAX_RETRIES,
        },
        segregationRef,
      },
      {
        $set: {
          status: OutboxStatus.PROCESSING,
          claimedBy,
          claimedAt: new Date(),
          claimExpiresAt: new Date(Date.now() + EXPIRES_IN_MS),
        },
      },
      { sort: { publicationDate: 1 }, returnDocument: "after" },
    );
    docs.push(doc);
  }
  const documents = docs.filter((d) => d !== null);

  logger.info(
    `Outbox repository claim events (segregationRef ${segregationRef}) end with number of docs ${documents.length}`,
  );
  return documents.map((doc) => Outbox.fromDocument(doc));
};

export const update = async (event, claimedBy) => {
  const document = event.toDocument();
  const { _id, ...updateDoc } = document;

  return db
    .collection(collection)
    .updateOne({ _id, claimedBy }, { $set: updateDoc });
};

export const insertMany = async (events, session) => {
  return db.collection(collection).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};

export const updateExpiredEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      claimExpiresAt: { $lt: new Date() },
      status: { $nin: [OutboxStatus.DEAD_LETTER, OutboxStatus.COMPLETED] },
    },
    {
      $set: {
        status: OutboxStatus.FAILED,
        // Nothing threw here - the claim simply outlived its holder - so the
        // sweep records itself as the reason.
        lastError: claimExpiredError(),
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
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
  return results;
};

export const updateFailedEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      status: OutboxStatus.FAILED,
    },
    {
      $set: {
        status: OutboxStatus.RESUBMITTED,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    },
  );
  return results;
};

export const updateResubmittedEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      status: OutboxStatus.RESUBMITTED,
    },
    {
      $set: {
        status: OutboxStatus.PUBLISHED,
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

export const updateDeadEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      completionAttempts: { $gte: MAX_RETRIES },
      status: { $ne: OutboxStatus.DEAD_LETTER },
    },
    {
      $set: {
        status: OutboxStatus.DEAD_LETTER,
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
    },
  );
  return results;
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

// This source's contribution to the faceted counts: the status split for
// everything the operator asked for. `status` is deliberately not a parameter
// - grouping BY status is the point. See common/event-facets.js, and
// common/status-counts.js for the accepted cost of the scan.
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
      redriveUpdate(OutboxStatus.RESUBMITTED, { by }),
      { returnDocument: "after", projection: listProjection },
    );

// How the dead letters in this box group by (failure message, event type).
// Scoped to DEAD_LETTER here rather than by the caller so the breakdown can
// never accidentally count a still-retrying row.
export const breakdown = async (filter = {}) =>
  toBreakdownGroups(
    await db
      .collection(collection)
      .aggregate(
        breakdownStages({
          filter: listFilter({ ...filter, status: REDRIVE_FROM_STATUS }),
          typeField: BREAKDOWN_TYPE_FIELDS.outbox,
          sortKey: "publicationDate",
        }),
      )
      .toArray(),
  );
