import Boom from "@hapi/boom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import {
  VERSION_EVENTS_BUDGET_MS,
  readVersionEvents,
} from "./version-events.js";

vi.mock("../../common/logger.js");

const EVENTS = { rows: [], more: false };

describe("readVersionEvents", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers the events read, with the sources that failed", async () => {
    const answer = await readVersionEvents("Overview", async () => ({
      content: { events: EVENTS },
      sourceErrors: [{ hop: "CW-BE" }],
    }));

    expect(answer).toEqual({
      outcome: "read",
      events: EVENTS,
      sourceErrors: [{ hop: "CW-BE" }],
    });
  });

  it("goes on without events that take longer than the budget", async () => {
    vi.useFakeTimers();
    const answer = readVersionEvents("Overview", () => new Promise(() => {}));

    await vi.advanceTimersByTimeAsync(VERSION_EVENTS_BUDGET_MS);

    expect(await answer).toEqual({ outcome: "timed-out" });
    expect(VERSION_EVENTS_BUDGET_MS).toBe(1500);
    expect(logger.warn).toHaveBeenCalledWith(
      "Overview: events took too long; Overview went on without them",
    );
  });

  it("answers failed, logging only the status, when the read fails", async () => {
    const answer = await readVersionEvents("Overview", async () => {
      throw Boom.badGateway("CW-BE said something private");
    });

    expect(answer).toEqual({ outcome: "failed" });
    expect(logger.warn).toHaveBeenCalledWith("Overview: events unread (502)");
  });
});
