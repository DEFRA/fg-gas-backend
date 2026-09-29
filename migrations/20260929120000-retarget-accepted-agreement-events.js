import { logger } from "../src/common/logger.js";

const EVENT_IDS = [
  "1a36cc25-c010-41d0-a18a-eaf6c9238d75",
  "2510219f-e9e0-47cf-841c-8175d420b043",
  "1f2dad1d-d437-4404-9ff9-28a406e23fc0",
];

const LEGACY_TOPIC_NAME = "agreement_status_updated_fifo.fifo";
const GAS_TOPIC_NAME = "gas__sns__agreement_status_updated_fifo.fifo";

const topicArns = () => {
  const gas = process.env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN;
  const suffix = `:${GAS_TOPIC_NAME}`;

  if (!gas?.endsWith(suffix)) {
    throw new Error(
      "GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN must identify the GAS-owned Agreement status topic",
    );
  }

  return {
    gas,
    legacy: `${gas.slice(0, -suffix.length)}:${LEGACY_TOPIC_NAME}`,
  };
};

export const up = async (db) => {
  const topics = topicArns();
  const result = await db.collection("outbox").updateMany(
    {
      status: "DEAD_LETTER",
      target: topics.legacy,
      "event.id": { $in: EVENT_IDS },
      "event.type": "io.onsite.agreement.status.updated",
      "event.data.status": "accepted",
    },
    { $set: { target: topics.gas } },
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
