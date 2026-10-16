import { describe, expect, it } from "vitest";
import { eventStatusValues } from "./event-status-values.js";
import { InboxStatus } from "./models/inbox.js";
import { OutboxStatus } from "./models/outbox.js";

describe("eventStatusValues", () => {
  it("lists the seven statuses in the order a message travels them", () => {
    expect(eventStatusValues).toEqual([
      { value: "PUBLISHED", label: "Queued", tone: "neutral" },
      { value: "PROCESSING", label: "Processing", tone: "info" },
      { value: "FAILED", label: "Failed", tone: "warning" },
      { value: "RESUBMITTED", label: "Resubmitted", tone: "warning" },
      { value: "COMPLETED", label: "Completed", tone: "success" },
      { value: "DEAD_LETTER", label: "Dead letter", tone: "error" },
      { value: "PURGED", label: "Purged", tone: "neutral" },
    ]);
  });

  it.each([
    ["outbox", OutboxStatus],
    ["inbox", InboxStatus],
  ])("holds every status an %s row can take", (_, statuses) => {
    expect(eventStatusValues.map(({ value }) => value).sort()).toEqual(
      Object.values(statuses).sort(),
    );
  });
});
