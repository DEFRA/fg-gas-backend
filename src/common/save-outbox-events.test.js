import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertMany } from "./outbox.repository.js";
import { saveOutboxEvents } from "./save-outbox-events.js";

vi.mock("./outbox.repository.js");

describe("saveOutboxEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds and inserts outbox records", async () => {
    const event = {
      data: { clientRef: "client-1", code: "pigs-might-fly" },
    };
    const session = { id: "session-1" };

    await saveOutboxEvents([{ event, target: "topic-arn" }], session);

    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          event,
          target: "topic-arn",
          segregationRef: "client-1-pigs-might-fly",
        }),
      ],
      session,
    );
  });

  it("does not write when there are no events", async () => {
    await saveOutboxEvents();

    expect(insertMany).not.toHaveBeenCalled();
  });
});
