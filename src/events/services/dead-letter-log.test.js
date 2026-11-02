import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import {
  DeadLetterReason,
  logDeadLetter,
  logDeadLettersSwept,
} from "./dead-letter-log.js";

vi.mock("../../common/logger.js", () => ({
  logger: { warn: vi.fn() },
}));

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
