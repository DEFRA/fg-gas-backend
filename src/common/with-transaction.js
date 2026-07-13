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
  let result;

  try {
    await session.withTransaction(async (activeSession) => {
      result = await callback(activeSession);
    }, options);
  } catch (e) {
    logger.error("ERROR: Transaction failed.");
    throw e;
  } finally {
    await session.endSession();
  }

  return result;
};
