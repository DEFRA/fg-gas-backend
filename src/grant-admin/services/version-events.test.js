import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { config } from "../../common/config.js";
import {
  VERSION_EVENTS_BUDGET_MS,
  readVersionEvents,
  withPastDeletion,
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

describe("withPastDeletion", () => {
  const RECEIVED_AT = "2026-08-01T09:00:00.000Z";
  const AFTER = new Date("2026-08-31T09:00:00.001Z");
  const READ = { outcome: "read", events: EVENTS, sourceErrors: [] };
  const ROW = { id: "6650c1f2a9e4b1d07c20bd91", status: "COMPLETED" };

  beforeEach(() => {
    vi.spyOn(config.events, "retentionDays", "get").mockReturnValue(30);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is past deletion once GAS's retention has run from the version's arrival", () => {
    expect(withPastDeletion(READ, RECEIVED_AT, AFTER)).toEqual({
      ...READ,
      pastDeletion: true,
    });
    expect(
      withPastDeletion(READ, RECEIVED_AT, new Date("2026-08-31T09:00:00.000Z"))
        .pastDeletion,
    ).toBe(false);
  });

  it.each([
    ["holds a later event of the version", { rows: [ROW], more: false }, []],
    ["holds more than was read", { rows: [], more: true }, []],
    ["could not be read", EVENTS, [{ hop: "GAS inbox" }]],
  ])("is not past deletion while the inbox %s", (_, events, sourceErrors) => {
    expect(
      withPastDeletion(
        { outcome: "read", events, sourceErrors },
        RECEIVED_AT,
        AFTER,
      ).pastDeletion,
    ).toBe(false);
  });

  it.each([{ outcome: "timed-out" }, { outcome: "failed" }])(
    "leaves an answer that read no events as it is: %o",
    (answer) => {
      expect(withPastDeletion(answer, RECEIVED_AT, AFTER)).toBe(answer);
    },
  );
});
