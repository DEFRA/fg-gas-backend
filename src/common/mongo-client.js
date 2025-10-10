import { MongoClient } from "mongodb";
import tls from "node:tls";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const mongoClient = new MongoClient(config.mongoUri, {
  retryWrites: false,
  readPreference: config.env === "production" ? "secondary" : "primary",
  secureContext: tls.createSecureContext(),
});

export const db = mongoClient.db(config.mongoDatabase);

const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "local" },
  writeConcern: { w: "majority" },
};

export const withTransaction = async (callback, propagateError = true) => {
  const session = mongoClient.startSession();

  try {
    await session.withTransaction(callback, transactionOptions);
  } catch (e) {
    logger.error("ERROR: Transaction failed");
    logger.error(e);

    if (propagateError) {
      throw new Error(`Transaction failed: ${e.message}`);
    }
  } finally {
    await session.endSession();
  }
};
