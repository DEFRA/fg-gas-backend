import Boom from "@hapi/boom";
import { ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { paginate } from "../../common/paginate.js";
import {
  AUDIT_TARGET_FIELDS,
  EVENT_TYPE_FIELDS,
  auditGroupExpression,
} from "../../events/event-audit.js";
import {
  breakdownStages,
  toBreakdownGroups,
} from "../../events/event-breakdown.js";
import { toSourceFacets } from "../../events/event-facets.js";
import { buildEventListFilter } from "../../events/event-list-filter.js";
import {
  REDRIVE_FROM_STATUS,
  redriveUpdate,
} from "../../events/event-redrive.js";
import {
  claimExpiredAttempt,
  claimExpiredError,
  pushAttemptUpdate,
} from "../../events/last-error.js";
import { statusGroupStage } from "../../events/status-counts.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const collection = "outbox";

const MAX_RETRIES = config.outbox.outboxMaxRetries;
const EXPIRES_IN_MS = config.outbox.outboxExpiresMs;
const NUMBER_OF_RECORDS = config.outbox.outboxClaimMaxRecords;

// `target` decides whether a type-less row is an audit record.
const listProjection = {
  _id: 1,
  target: 1,
  "event.id": 1,
  "event.type": 1,
  status: 1,
  publicationDate: 1,
  completionDate: 1,
};

// A BSON Date on every outbox row; the cursor carries it as ISO.
const listCodecs = {
  publicationDate: {
    encode: (value) => (value instanceof Date ? value.toISOString() : value),
    // `new Date(null)` is the epoch, so a null position is refused.
    decode: (value) => {
      const date = new Date(value);

      if (typeof value !== "string" || Number.isNaN(date.getTime())) {
        throw Boom.badRequest("Cursor publicationDate is not an instant");
      }

      return date;
    },
  },
  _id: {
    encode: (id) => id.toString(),
    decode: (hex) => ObjectId.createFromHexString(hex),
  },
};

// A BSON Date field: a string bound would silently match nothing.
const listFilter = ({ status, q, error, from, to, audit }) =>
  buildEventListFilter({
    status,
    q,
    error,
    from,
    to,
    audit,
    targetField: AUDIT_TARGET_FIELDS.outbox,
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
        lastError: claimExpiredError(),
        claimedAt: null,
        claimExpiresAt: null,
        claimedBy: null,
      },
      // Applied by Mongo: `$slice` keeps the ten most recent entries per row.
      $push: pushAttemptUpdate(claimExpiredAttempt()),
      // An expired claim is a failed attempt, counted where it is recorded.
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
      // No `$inc`: a state transition, not an attempt.
    },
  );
  return results;
};

export const updateDeadEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      completionAttempts: { $gte: MAX_RETRIES },
      // COMPLETED is excluded for the same reason as in `updateExpiredEvents`:
      // a success is terminal. The counter counts failures, so a row that
      // succeeded normally sits below the cap and never matches - but lowering
      // `OUTBOX_MAX_RETRIES` puts already-succeeded rows at or above it.
      status: { $nin: [OutboxStatus.DEAD_LETTER, OutboxStatus.COMPLETED] },
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
  pageSize = 20,
  status,
  q,
  error,
  from,
  to,
  audit,
} = {}) =>
  paginate(db.collection(collection), {
    filter: listFilter({ status, q, error, from, to, audit }),
    sort: listSort,
    codecs: listCodecs,
    maxTimeMS: config.adminReadTimeoutMs,
    cursor,
    pageSize,
    project: listProjection,
  });

export const countFacets = async (filter = {}) =>
  toSourceFacets(
    await db
      .collection(collection)
      .aggregate([{ $match: listFilter(filter) }, statusGroupStage()], {
        maxTimeMS: config.adminReadTimeoutMs,
      })
      .toArray(),
  );

const toId = (id) => ObjectId.createFromHexString(id);

// `claimedBy` is a live claim token and is never exposed.
export const findById = (id) =>
  db
    .collection(collection)
    .findOne(
      { _id: toId(id) },
      { projection: { claimedBy: 0 }, maxTimeMS: config.adminReadTimeoutMs },
    );

export const findStatusById = async (id, session) => {
  const doc = await db
    .collection(collection)
    .findOne({ _id: toId(id) }, { projection: { status: 1 }, session });

  return doc ? doc.status : null;
};

// True when a DEAD_LETTER row was redriven.
export const redriveById = async (id, { by, session } = {}) => {
  const { matchedCount } = await db
    .collection(collection)
    .updateOne(
      { _id: toId(id), status: REDRIVE_FROM_STATUS },
      redriveUpdate(OutboxStatus.RESUBMITTED, { by }),
      { session },
    );

  return matchedCount > 0;
};

// Scoped to DEAD_LETTER here so it can never count a still-retrying row.
export const breakdown = async (filter = {}) =>
  toBreakdownGroups(
    await db
      .collection(collection)
      .aggregate(
        breakdownStages({
          filter: listFilter({ ...filter, status: OutboxStatus.DEAD_LETTER }),
          typeField: EVENT_TYPE_FIELDS.outbox,
          auditExpression: auditGroupExpression(AUDIT_TARGET_FIELDS.outbox),
          sortKey: "publicationDate",
        }),
        { maxTimeMS: config.adminReadTimeoutMs },
      )
      .toArray(),
  );
