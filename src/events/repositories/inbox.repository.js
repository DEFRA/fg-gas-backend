import { ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { editUpdate, revisionFilter } from "../event-edit.js";
import { purgeUpdate } from "../event-purge.js";
import {
  DEAD_LETTER,
  REDRIVABLE_STATUSES,
  redriveUpdate,
} from "../event-redrive.js";
import {
  claimExpiredAttempt,
  claimExpiredError,
  withErrorKey,
  pushAttemptUpdate,
} from "../last-error.js";
import { withoutStamps } from "../stamps.js";
import { Inbox, InboxStatus } from "../models/inbox.js";

const collection = "inbox";
const MAX_RETRIES = config.inbox.inboxMaxRetries;
const NUMBER_OF_RECORDS = config.inbox.inboxClaimMaxRecords;
const EXPIRES_IN_MS = config.inbox.inboxExpiresMs;
const RETENTION_DAYS = config.events.retentionDays;

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
  const results = await db.collection(collection).updateMany(
    {
      claimExpiresAt: { $lt: new Date() },
      // Terminal too: a stale claim must not put a purged row back in the cycle.
      status: {
        $nin: [
          InboxStatus.DEAD_LETTER,
          InboxStatus.COMPLETED,
          InboxStatus.PURGED,
        ],
      },
    },
    {
      $set: {
        status: InboxStatus.FAILED,
        ...withErrorKey(claimExpiredError()),
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
      // Applied by Mongo: `$slice` keeps the ten most recent entries per row.
      $push: pushAttemptUpdate(claimExpiredAttempt()),
      // An expired claim is a failed attempt, counted where it is recorded.
      $inc: { completionAttempts: 1 },
    },
  );
  return results;
};

export const updateDeadEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
      completionAttempts: { $gte: MAX_RETRIES },
      // A success is terminal. The counter counts failures, so a row that
      // succeeded normally sits below the cap and never matches - but lowering
      // `INBOX_MAX_RETRIES` puts already-succeeded rows at or above it.
      // A purged row keeps the attempts that killed it, so it sits at the cap
      // and this sweep would flip it back to DEAD_LETTER on the next tick.
      status: {
        $nin: [
          InboxStatus.DEAD_LETTER,
          InboxStatus.COMPLETED,
          InboxStatus.PURGED,
        ],
      },
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

export const updateFailedEvents = async () => {
  const results = await db.collection(collection).updateMany(
    {
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
      // No `$inc`: a state transition, not an attempt.
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

// Matching on `claimedBy` stops a handler that outlived its claim from
// overwriting whatever happened to the row after the claim expired.
export const update = async (inbox, claimedBy) => {
  const { _id, ...updateDoc } = withoutStamps(inbox.toDocument());

  return db
    .collection(collection)
    .updateOne({ _id, claimedBy }, { $set: updateDoc });
};

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

// True when a redrivable row - a dead letter, or one an operator purged - was
// redriven.
export const redriveById = async (id, { by, session } = {}) => {
  const { matchedCount } = await db
    .collection(collection)
    .updateOne(
      { _id: toId(id), status: { $in: REDRIVABLE_STATUSES } },
      redriveUpdate(InboxStatus.RESUBMITTED, { by }),
      { session },
    );

  return matchedCount > 0;
};

// True when a DEAD_LETTER row was purged. The fence is the whole of the
// concurrency control: a lost race returns false and the caller reads the
// status.
export const purgeById = async (id, { by, reasonCode, note, session } = {}) => {
  const { matchedCount } = await db.collection(collection).updateOne(
    { _id: toId(id), status: DEAD_LETTER },
    purgeUpdate(InboxStatus.PURGED, {
      by,
      reasonCode,
      note,
      retentionDays: RETENTION_DAYS,
    }),
    { session },
  );

  return matchedCount > 0;
};

// What an edit needs to decide on and to diff against, read in its transaction.
export const findEditableById = (id, session) =>
  db.collection(collection).findOne(
    { _id: toId(id) },
    {
      projection: { status: 1, event: 1, payloadRevision: 1, lastEdit: 1 },
      session,
    },
  );

// True when a redrivable row still at `revision` took the new payload. A lost
// race - a status change or another edit - returns false and the caller reads
// the status.
export const editPayloadById = async (
  id,
  { revision, event, original, by, note, session },
) => {
  const { matchedCount } = await db.collection(collection).updateOne(
    {
      _id: toId(id),
      status: { $in: REDRIVABLE_STATUSES },
      payloadRevision: revisionFilter(revision),
    },
    editUpdate({
      event,
      by,
      note,
      revision,
      original,
      inboxColumns: Inbox.eventColumns(event),
    }),
    { session },
  );

  return matchedCount > 0;
};
