import { logger } from "./logger.js";
import { mongoClient } from "./mongo-client.js";

export const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "local" },
  writeConcern: { w: "majority" },
};

export const withTransaction = async (callback) => {
  const session = mongoClient.startSession();

  try {
    await session.withTransaction(callback, transactionOptions);
  } catch (e) {
    logger.error("ERROR: Transaction failed.");
    logger.error(e.message);

    throw new Error(`Transaction failed: ${e.message}`);
  } finally {
    await session.endSession();
  }
};
