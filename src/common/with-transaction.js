import { logger } from "./logger.js";
import { mongoClient } from "./mongo-client.js";

export const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "local" },
  writeConcern: { w: "majority" },
};

export const withTransaction = async (
  callback,
  onAudit,
  options = transactionOptions,
) => {
  const session = mongoClient.startSession();

  try {
    await session.withTransaction(async (session) => {
      await callback(session);
      if (onAudit) {
        await onAudit(session).catch((err) =>
          logger.error({ err }, "Failed to write audit event"),
        );
      }
    }, options);
  } catch (e) {
    logger.error("ERROR: Transaction failed.");
    if (onAudit) {
      onAudit().catch((err) =>
        logger.error({ err }, "Failed to write audit event"),
      );
    }
    throw e;
  } finally {
    await session.endSession();
  }
};
