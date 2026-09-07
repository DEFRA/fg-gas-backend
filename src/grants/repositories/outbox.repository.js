import { config } from "../../common/config.js";
import {
  claimExpiredAttempt,
  claimExpiredError,
  pushAttemptUpdate,
} from "../../common/last-error.js";
import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const collection = "outbox";

const MAX_RETRIES = config.outbox.outboxMaxRetries;
const EXPIRES_IN_MS = config.outbox.outboxExpiresMs;
const NUMBER_OF_RECORDS = config.outbox.outboxClaimMaxRecords;

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
      // operation that records it - see ATTEMPT ARITHMETIC in models/outbox.js.
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
      // sweep (updateDeadEvents) kill a row at the cap before its final
      // attempt ran - the "5/5 with four history entries" bug.
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
