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

// Exactly the fields a merged list row (and a journey hop) is derived from -
// see grant-admin/services/map-event-row.js - plus the two event subfields the
// row's id and type come out of. Never the full `event`, `event.data`, or
// `claimedBy`; the detail-only fields (`segregationRef`, `lastRedrive`,
// `attemptHistory`) ride `findById`'s whole document instead.
const listProjection = {
  _id: 1,
  target: 1,
  "event.id": 1,
  "event.type": 1,
  status: 1,
  completionAttempts: 1,
  publicationDate: 1,
  lastResubmissionDate: 1,
  completionDate: 1,
  lastError: 1,
};

// publicationDate is a native Date on every outbox document
// (models/outbox.js:37), so the cursor carries it as an ISO string.
const listCodecs = {
  publicationDate: {
    encode: (value) => (value instanceof Date ? value.toISOString() : value),
    // A shape-valid cursor carrying `null` here used to decode to `new
    // Date(null)` - the epoch - and quietly pin the page to 1970 rather than
    // being refused. A position this service did not write is a 400.
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

// `publicationDate` is the box's sort key AND its time-range field, and it is
// a BSON Date on every outbox document (models/outbox.js), so an ISO bound is
// coerced to a Date - a string bound would silently match nothing.
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
      // No `$inc`: a state transition, not an attempt - see ATTEMPT
      // ARITHMETIC in models/inbox.js.
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
  audit,
} = {}) =>
  paginate(db.collection(collection), {
    filter: listFilter({ status, q, error, from, to, audit }),
    sort: listSort,
    codecs: listCodecs,
    // The admin surface's own ceiling: this read can be a collection scan.
    maxTimeMS: config.adminReadTimeoutMs,
    cursor,
    direction,
    pageSize,
    project: listProjection,
  });

// This source's contribution to the faceted counts: the status split for
// everything the operator asked for. `status` is deliberately not a parameter
// - grouping BY status is the point. See events/event-facets.js, and
// events/status-counts.js for the accepted cost of the scan.
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

// The whole stored document minus the claim token - the detail view is the one
// place allowed to read the `event` payload, and only one row at a time.
// `claimedBy` is a live claim token and is never exposed.
export const findById = (id) =>
  db
    .collection(collection)
    .findOne({ _id: toId(id) }, { projection: { claimedBy: 0 } });

// Only used to tell a 404 from a 409 after a redrive matched nothing.
// `session` joins the caller's transaction where there is one, so the status
// this reads is the one that transaction can see - the redrive's own failed
// match and this follow-up read must not disagree about the row.
export const findStatusById = async (id, session) => {
  const doc = await db
    .collection(collection)
    .findOne({ _id: toId(id) }, { projection: { status: 1 }, session });

  return doc ? doc.status : null;
};

// A single conditional update: the DEAD_LETTER filter is the precondition, so
// a row that changed status between the read and the write simply matches
// nothing and the caller reports a 409 rather than clobbering it. Answers with
// the updated document in the list projection.
// `session` joins the caller's transaction where there is one, so the row's
// update and the audit event's outbox insert commit together or not at all.
// Undefined outside a transaction, which the driver treats as no session.
export const redriveById = (id, { by, session } = {}) =>
  db
    .collection(collection)
    .findOneAndUpdate(
      { _id: toId(id), status: REDRIVE_FROM_STATUS },
      redriveUpdate(OutboxStatus.RESUBMITTED, { by }),
      { returnDocument: "after", projection: listProjection, session },
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
          filter: listFilter({ ...filter, status: OutboxStatus.DEAD_LETTER }),
          typeField: EVENT_TYPE_FIELDS.outbox,
          auditExpression: auditGroupExpression(AUDIT_TARGET_FIELDS.outbox),
          sortKey: "publicationDate",
        }),
        { maxTimeMS: config.adminReadTimeoutMs },
      )
      .toArray(),
  );
