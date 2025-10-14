import { logger } from "../../common/logger.js";
import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";

const collection = "outbox";
const MAX_RETRIES = 5;
const NUMBER_OF_RECORDS = 2;
const EXPIRES_IN_MS = 3000000;

export const fetchPendingEvents = async (claimedBy) => {
  const promises = [];

  for (let i = 0; i < NUMBER_OF_RECORDS; i++) {
    promises.push(
      db.collection(collection).findOneAndUpdate(
        {
          status: {
            $eq: OutboxStatus.PUBLISHED,
          },
          claimedBy: {
            $eq: null,
          },
          completionAttempts: {
            $lte: MAX_RETRIES,
          },
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

  logger.info(`Found ${documents.length} outbox documents to process.`);

  return documents.map((doc) => Outbox.fromDocument(doc));
};

export const insertMany = async (events, session) => {
  return db.collection(collection).insertMany(
    events.map((event) => event.toDocument()),
    { session },
  );
};
