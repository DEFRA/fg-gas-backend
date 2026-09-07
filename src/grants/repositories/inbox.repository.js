import { config } from "../../common/config.js";
import {
  claimExpiredAttempt,
  claimExpiredError,
  pushAttemptUpdate,
} from "../../common/last-error.js";
import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";

const collection = "inbox";
const MAX_RETRIES = config.inbox.inboxMaxRetries;
const NUMBER_OF_RECORDS = config.inbox.inboxClaimMaxRecords;
const EXPIRES_IN_MS = config.inbox.inboxExpiresMs;

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
      status: { $nin: [InboxStatus.DEAD_LETTER, InboxStatus.COMPLETED] },
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
      status: { $ne: InboxStatus.DEAD_LETTER },
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
      // sweep (updateDeadEvents) kill a row at the cap before its final
      // attempt ran - the
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
