import { logger } from "../src/common/logger.js";

const EVENT_IDS = [
  "1a36cc25-c010-41d0-a18a-eaf6c9238d75",
  "2510219f-e9e0-47cf-841c-8175d420b043",
  "1f2dad1d-d437-4404-9ff9-28a406e23fc0",
];

const LEGACY_TOPIC =
  "arn:aws:sns:eu-west-2:409408189387:agreement_status_updated_fifo.fifo";
const GAS_TOPIC =
  "arn:aws:sns:eu-west-2:409408189387:gas__sns__agreement_status_updated_fifo.fifo";

export const up = async (db) => {
  if (process.env.ENVIRONMENT !== "prod") {
    return;
  }

  const result = await db.collection("outbox").updateMany(
    {
      status: "DEAD_LETTER",
      target: LEGACY_TOPIC,
      "event.id": { $in: EVENT_IDS },
      "event.type": "io.onsite.agreement.status.updated",
      "event.data.status": "accepted",
    },
    { $set: { target: GAS_TOPIC } },
  );

  logger.info(
    {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      expectedCount: EVENT_IDS.length,
    },
    "Retargeted accepted Agreement lifecycle dead letters",
  );
};
