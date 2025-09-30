import { MongoClient } from "mongodb";
import tls from "node:tls";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const mongoClient = new MongoClient(config.mongoUri, {
  retryWrites: false,
  readPreference: "secondary",
  secureContext: tls.createSecureContext(),
});

export const db = mongoClient.db(config.mongoDatabase);

export const withTransaction = async (callback) => {
  const session = mongoClient.startSession();

  try {
    await session.withTransaction(async () => {
       await callback(session);
    });
    await session.commitTransaction();
  } catch(e) {
    logger.error(e);
    await session.abortTransaction();
  } finally {
    await session.endSession();
  }
};
