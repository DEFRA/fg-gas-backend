import { setTimeout } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../common/logger.js";
import {
  DeadLetterGauge,
  DeadLetterReason,
  logDeadLetter,
  logDeadLettersSwept,
} from "./dead-letters.js";

const gauge = vi.hoisted(() => vi.fn());

vi.mock("@defra/cdp-metrics", () => ({
  Metrics: class {
    gauge = gauge;
  },
}));
vi.mock("node:timers/promises");
vi.mock("../common/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const runPasses = async (counts, passes = 1) => {
  const deadLetterGauge = new DeadLetterGauge({ enabled: true, counts });
  let remaining = passes;

  setTimeout.mockImplementation(async () => {
    remaining -= 1;

    if (remaining === 0) {
      deadLetterGauge.stop();
    }
  });

  deadLetterGauge.start();

  await vi.waitFor(() => expect(setTimeout).toHaveBeenCalledTimes(passes));
};

describe("DeadLetterGauge", () => {
  let inbox;
  let outbox;

  beforeEach(() => {
    inbox = vi.fn().mockResolvedValue(3);
    outbox = vi.fn().mockResolvedValue(4);
  });

  it("sends each box's count with only a box dimension", async () => {
    await runPasses({ inbox, outbox });

    expect(gauge.mock.calls).toEqual([
      ["deadLetters", 3, { box: "inbox" }],
      ["deadLetters", 4, { box: "outbox" }],
    ]);
  });

  it("sends a real zero", async () => {
    inbox.mockResolvedValue(0);

    await runPasses({ inbox });

    expect(gauge).toHaveBeenCalledWith("deadLetters", 0, { box: "inbox" });
  });

  it("sends nothing for a box whose count fails, and still sends the rest", async () => {
    const error = new Error("no secondary");
    inbox.mockRejectedValue(error);

    await runPasses({ inbox, outbox });

    expect(gauge.mock.calls).toEqual([["deadLetters", 4, { box: "outbox" }]]);
    expect(logger.error).toHaveBeenCalledWith(
      error,
      "Error counting inbox dead letters",
    );
  });

  it("reports on the next pass after a failed one", async () => {
    inbox.mockRejectedValueOnce(new Error("no secondary"));

    await runPasses({ inbox }, 2);

    expect(gauge.mock.calls).toEqual([["deadLetters", 3, { box: "inbox" }]]);
  });

  it("sleeps a minute between passes on an unref'd timer", async () => {
    await runPasses({ inbox });

    expect(setTimeout).toHaveBeenCalledWith(60_000, undefined, { ref: false });
  });

  it("never counts or sends when disabled", async () => {
    new DeadLetterGauge({ enabled: false, counts: { inbox } }).start();

    await Promise.resolve();

    expect(inbox).not.toHaveBeenCalled();
    expect(gauge).not.toHaveBeenCalled();
  });

  it("logs a loop that dies rather than leaving it unhandled", async () => {
    const error = new Error("timer failed");
    setTimeout.mockRejectedValue(error);

    new DeadLetterGauge({ enabled: true, counts: { inbox } }).start();

    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        error,
        "Dead letter gauge stopped",
      ),
    );
  });

  it("stops polling once stopped", async () => {
    await runPasses({ inbox });
    await Promise.resolve();

    expect(inbox).toHaveBeenCalledTimes(1);
  });
});

describe("dead letter logs", () => {
  it("logs one row's id and error key, with no payload", () => {
    logDeadLetter("inbox", DeadLetterReason.NON_RETRYABLE, {
      _id: "row-1",
      eventType: "case.create",
      errorKey: "bad message",
      event: { data: { clientRef: "secret" } },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: {
          action: "dead_letter",
          category: "inbox",
          type: "case.create",
          reason: "non_retryable",
          reference: "row-1",
        },
        error: { code: "bad message" },
      },
      "Event row-1 in inbox became a dead letter",
    );
  });

  it("logs a sweep's box and count", () => {
    logDeadLettersSwept("outbox", 2);

    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: {
          action: "dead_letter",
          category: "outbox",
          reason: "retries_exhausted",
          reference: "2",
        },
      },
      "2 events in outbox became dead letters",
    );
  });
});
