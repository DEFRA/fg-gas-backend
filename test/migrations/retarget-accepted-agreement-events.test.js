import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/common/logger.js";
import { up } from "../../migrations/20260929120000-retarget-accepted-agreement-events.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn() },
}));

const EVENT_IDS = [
  "00000000-0000-4000-8000-000000005000",
  "00000000-0000-4000-8000-000000005064",
  "00000000-0000-4000-8000-000000005001",
];

const ACCOUNT = "111122223333";
const LEGACY_TOPIC = `arn:aws:sns:eu-west-2:${ACCOUNT}:agreement_status_updated_fifo.fifo`;
const GAS_TOPIC = `arn:aws:sns:eu-west-2:${ACCOUNT}:gas__sns__agreement_status_updated_fifo.fifo`;

const originalTopic =
  process.env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN;

afterEach(() => {
  if (originalTopic === undefined) {
    delete process.env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN;
  } else {
    process.env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN = originalTopic;
  }
  vi.clearAllMocks();
});

describe("retarget accepted Agreement events migration", () => {
  it("retargets only the three accepted legacy dead letters in the current environment", async () => {
    process.env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN = GAS_TOPIC;
    const updateMany = vi.fn().mockResolvedValue({
      matchedCount: 3,
      modifiedCount: 3,
    });
    const db = {
      collection: vi.fn().mockReturnValue({ updateMany }),
    };

    await up(db);

    expect(db.collection).toHaveBeenCalledWith("outbox");
    expect(updateMany).toHaveBeenCalledWith(
      {
        status: "DEAD_LETTER",
        target: LEGACY_TOPIC,
        "event.id": { $in: EVENT_IDS },
        "event.type": "io.onsite.agreement.status.updated",
        "event.data.status": "accepted",
      },
      { $set: { target: GAS_TOPIC } },
    );
    expect(logger.info).toHaveBeenCalledWith(
      {
        matchedCount: 3,
        modifiedCount: 3,
        expectedCount: 3,
      },
      "Retargeted accepted Agreement lifecycle dead letters",
    );
  });

  it("refuses to derive a target from an unexpected configured topic", async () => {
    process.env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN =
      `arn:aws:sns:eu-west-2:${ACCOUNT}:unexpected.fifo`;
    const db = { collection: vi.fn() };

    await expect(up(db)).rejects.toThrow(
      "GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN must identify the GAS-owned Agreement status topic",
    );
    expect(db.collection).not.toHaveBeenCalled();
  });
});
