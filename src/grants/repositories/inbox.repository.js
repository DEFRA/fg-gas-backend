import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";

const collection = "inbox";
const MAX_RETRIES = config.inbox.inboxMaxRetries;
const NUMBER_OF_RECORDS = config.inbox.inboxClaimMaxRecords;
const EXPIRES_IN_MS = config.inbox.inboxExpiresMs;

export const claimEvents = async (claimedBy) => {
  const promises = [];

  for (let i = 0; i < NUMBER_OF_RECORDS; i++) {
    promises.push(
      db.collection(collection).findOneAndUpdate(
        {
          status: { $eq: InboxStatus.PUBLISHED },
          claimedBy: { $eq: null },
          completionAttempts: { $lte: MAX_RETRIES },
        },
        {
          $set: {
            status: InboxStatus.PROCESSING,
            claimedBy,
            claimedAt: new Date(),
            claimExpiresAt: new Date(Date.now() + EXPIRES_IN_MS),
          },
        },
        { sort: { publicationDate: 1 }, returnDocument: "after" },
      ),
    );
  }

  const docs = await Promise.all(promises);
  const documents = docs.filter((d) => d !== null);

  logger.info(`Found ${documents.length} inbox documents to process.`);

  return documents.map((doc) => Inbox.fromDocument(doc));
};

export const processExpiredEvents = async () => {
  await db.collection(collection).updateMany(
    {
      claimExpiresAt: { $lt: new Date() },
    },
    {
      $set: {
        status: InboxStatus.FAILED,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    },
  );
};

export const updateDeadEvents = async () => {
  const results = await db.collection(collection).updateMany(
    { completionAttempts: { $gte: MAX_RETRIES } },
    {
      $set: {
        status: InboxStatus.DEAD,
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
      $inc: { completionAttempts: 1 },
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
