import Boom from "@hapi/boom";
import { logger } from "./logger.js";
import { mongoClient } from "./mongo-client.js";

export const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "local" },
  writeConcern: { w: "majority" },
};

const SERVER_ERROR = 500;

// A 4xx is the use case refusing the request, not the transaction failing.
const isRefusal = (error) =>
  Boom.isBoom(error) && error.output.statusCode < SERVER_ERROR;

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
    if (!isRefusal(e)) {
      logger.error("ERROR: Transaction failed.");
    }

    throw e;
  } finally {
    await session.endSession();
  }

  return result;
};
