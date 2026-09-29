import { logger } from "../src/common/logger.js";

const EVENT_IDS = [
  "00000000-0000-4000-8000-000000005000",
  "00000000-0000-4000-8000-000000005064",
  "00000000-0000-4000-8000-000000005001",
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
