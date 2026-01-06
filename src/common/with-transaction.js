import { logger } from "./logger.js";
import { mongoClient } from "./mongo-client.js";

export const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "local" },
  writeConcern: { w: "majority" },
};

export const withTransaction = async (
  callback,
  options = transactionOptions,
) => {
  const session = mongoClient.startSession();
  // eslint-disable-next-line no-console
  console.log("mongoClient", mongoClient);
  // eslint-disable-next-line no-console
  console.log("withTransaction -> session", session);
  try {
    await session.withTransaction(callback, options);
  } catch (e) {
    logger.error("ERROR: Transaction failed.");
    throw e;
  } finally {
    await session?.endSession();
  }
};
