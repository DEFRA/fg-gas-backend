import { logger } from "../src/common/logger.js";

// A row stored without a status is claimed by no poller and listed under no
// status. Dead letter keeps it inspectable and purgeable without claiming it
// was ever delivered.

export const up = async (db) => {
  const { modifiedCount } = await db.collection("outbox").updateMany(
    { status: null },
    {
      $set: {
        status: "DEAD_LETTER",
        lastError: {
          name: "MissingStatus",
          message: "stored without a status",
          at: new Date().toISOString(),
        },
      },
    },
  );

  logger.info(
    `Dead-lettered ${modifiedCount} outbox rows stored without a status`,
  );
};
