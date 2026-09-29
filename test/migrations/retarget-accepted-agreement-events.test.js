import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/common/logger.js";
import { up } from "../../migrations/20260929120000-retarget-accepted-agreement-events.js";

vi.mock("../../src/common/logger.js", () => ({
  logger: { info: vi.fn() },
}));

const EVENT_IDS = [
  "1a36cc25-c010-41d0-a18a-eaf6c9238d75",
  "2510219f-e9e0-47cf-841c-8175d420b043",
  "1f2dad1d-d437-4404-9ff9-28a406e23fc0",
];

const LEGACY_TOPIC =
  "arn:aws:sns:eu-west-2:409408189387:agreement_status_updated_fifo.fifo";
const GAS_TOPIC =
  "arn:aws:sns:eu-west-2:409408189387:gas__sns__agreement_status_updated_fifo.fifo";

const originalEnvironment = process.env.ENVIRONMENT;

afterEach(() => {
  process.env.ENVIRONMENT = originalEnvironment;
  vi.clearAllMocks();
});

describe("retarget accepted Agreement events migration", () => {
  it("does nothing outside production", async () => {
    process.env.ENVIRONMENT = "test";
    const db = { collection: vi.fn() };

    await up(db);

    expect(db.collection).not.toHaveBeenCalled();
  });

  it("retargets only the three accepted legacy dead letters", async () => {
    process.env.ENVIRONMENT = "prod";
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
});
