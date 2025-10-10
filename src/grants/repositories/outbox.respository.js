import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const COLLECTION_NAME = "event_publication_outbox";
const MAX_RETRIES = 5;
const NUMBER_OF_RECORDS = 2;
const EXPIRES_IN_MS = 3000000;

export const fetchPendingEvents = async (claimedBy) => {
  const promises = [];

  for (let i = 0; i < NUMBER_OF_RECORDS; i++) {
    promises.push(
      db.collection(COLLECTION_NAME).findOneAndUpdate(
        {
          status: { $eq: OutboxStatus.PUBLISHED },
          claimedBy: { $eq: null },
          completionAttempts: { $lte: MAX_RETRIES },
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
      ),
    );
  }
  const docs = await Promise.all(promises);
  const documents = docs.filter((d) => d !== null);

  logger.info(`Found ${documents.length} outboc documents to process.`);

  return documents.map((doc) => Outbox.fromDocument(doc));
};

// Move events that have been retried to dead status
export const updateDeadEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
    { completionAttempts: { $gte: MAX_RETRIES } },
    {
      $set: {
        status: OutboxStatus.DEAD,
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
  const results = await db.collection(COLLECTION_NAME).updateMany(
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

// Move resubmitted events to published status
export const updateResubmittedEvents = async () => {
  const results = await db.collection(COLLECTION_NAME).updateMany(
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
      $inc: { completionAttempts: 1 },
    },
  );
  return results;
};

export const insertMany = async (events, session) => {
  return db.collection(COLLECTION_NAME).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};

export const insert = async (eventPublication, session) => {
  const document = eventPublication.toDocument();
  return db.collection(COLLECTION_NAME).insertOne(document, { session });
};

export const update = async (eventPublication) => {
  const document = eventPublication.toDocument();
  const { _id, ...updateDoc } = document;

  return db.collection(COLLECTION_NAME).updateOne({ _id }, { $set: updateDoc });
};
