import { setTimeout } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import { db } from "../mongo-client.js";
import { sweepRecords } from "./store.js";
import { SearchSweeper, nextSweep } from "./sweeper.js";

vi.mock("node:timers/promises");
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../mongo-client.js", () => ({
  db: { collection: vi.fn() },
  mongoClient: {},
}));
vi.mock("../with-transaction.js", () => ({
  withTransaction: (work) => work("a-session"),
}));
vi.mock("./store.js", () => ({
  sweepRecords: vi.fn(),
  warnLeftOut: vi.fn(),
}));

const now = new Date("2026-10-01T00:00:00Z");
const earlier = new Date("2026-09-30T00:00:00Z");

describe("nextSweep", () => {
  it("starts a pass at its first batch", () => {
    expect(nextSweep(null, { checked: 2, fixed: 1, last: "b" }, now)).toEqual({
      state: {
        after: "b",
        passStartedAt: now,
        lastPassCompletedAt: null,
        checked: 2,
        fixed: 1,
      },
      completed: null,
    });
  });

  it("carries a pass on from where it stopped", () => {
    const state = {
      after: "b",
      passStartedAt: earlier,
      lastPassCompletedAt: null,
      checked: 2,
      fixed: 1,
    };

    expect(nextSweep(state, { checked: 2, fixed: 0, last: "d" }, now)).toEqual({
      state: { ...state, after: "d", checked: 4, fixed: 1 },
      completed: null,
    });
  });

  it("completes a pass at the end of the records and starts over", () => {
    const state = {
      after: "d",
      passStartedAt: earlier,
      lastPassCompletedAt: null,
      checked: 4,
      fixed: 1,
    };

    expect(nextSweep(state, { checked: 1, fixed: 2, last: null }, now)).toEqual(
      {
        state: {
          after: null,
          passStartedAt: null,
          lastPassCompletedAt: now,
          checked: 0,
          fixed: 0,
        },
        completed: { checked: 5, fixed: 3 },
      },
    );
  });
});

describe("SearchSweeper", () => {
  const current = vi.fn();
  const source = { collection: "record_search", declarations: { current } };
  let sweeps;

  beforeEach(() => {
    vi.clearAllMocks();
    current.mockResolvedValue(new Map());
    sweeps = {
      findOneAndUpdate: vi.fn(),
      updateOne: vi.fn(),
      replaceOne: vi.fn(),
    };
    db.collection.mockReturnValue(sweeps);
  });

  const sweeper = () =>
    new SearchSweeper({ source, batchSize: 2, intervalMs: 30_000 });

  it("sweeps after the stored position and stores the next", async () => {
    sweeps.findOneAndUpdate.mockResolvedValue({
      after: "b",
      checked: 2,
      fixed: 0,
    });
    sweepRecords.mockResolvedValue({
      checked: 2,
      changed: [],
      removed: 0,
      last: "d",
    });

    await sweeper().sweepBatch();

    expect(db.collection).toHaveBeenCalledWith("search_sweeps");
    expect(sweeps.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: "record_search",
        lastBatchAt: { $not: { $gt: expect.any(Date) } },
      },
      { $set: { lastBatchAt: expect.any(Date) } },
      { projection: { _id: 0 }, returnDocument: "after", session: "a-session" },
    );
    expect(sweepRecords).toHaveBeenCalledWith(
      source,
      new Map(),
      { after: "b", limit: 2 },
      "a-session",
    );
    expect(sweeps.replaceOne).toHaveBeenCalledWith(
      { _id: "record_search" },
      expect.objectContaining({
        after: "d",
        checked: 4,
        lastBatchAt: expect.any(Date),
      }),
      { session: "a-session" },
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("claims no batch within the interval of the last, and reads no records", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T00:00:30.000Z") });
    sweeps.findOneAndUpdate.mockResolvedValue(null);

    try {
      await sweeper().sweepBatch();
    } finally {
      vi.useRealTimers();
    }

    const [[filter]] = sweeps.findOneAndUpdate.mock.calls;
    expect(filter.lastBatchAt.$not.$gt).toEqual(
      new Date("2026-10-01T00:00:00.000Z"),
    );
    expect(sweepRecords).not.toHaveBeenCalled();
    expect(sweeps.replaceOne).not.toHaveBeenCalled();
  });

  it("logs a clean pass with its count", async () => {
    sweeps.findOneAndUpdate.mockResolvedValue({
      after: "b",
      checked: 2,
      fixed: 0,
    });
    sweepRecords.mockResolvedValue({
      checked: 1,
      changed: [],
      removed: 0,
      last: null,
    });

    await sweeper().sweepBatch();

    expect(logger.info).toHaveBeenCalledWith(
      "Search record_search: swept 3 records, fixed 0 documents",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("warns of a pass that fixed documents", async () => {
    sweeps.findOneAndUpdate.mockResolvedValue({ after: null });
    sweepRecords.mockResolvedValue({
      checked: 1,
      changed: [{ document: {}, left: {} }],
      removed: 1,
      last: null,
    });

    await sweeper().sweepBatch();

    expect(logger.warn).toHaveBeenCalledWith(
      "Search record_search: swept 1 records, fixed 2 documents",
    );
  });

  it("wakes every interval, without holding the process open, and logs a failed batch", async () => {
    const error = new Error("no primary");
    current.mockRejectedValueOnce(error);
    sweeps.findOneAndUpdate.mockResolvedValue({ after: null });
    sweepRecords.mockResolvedValue({
      checked: 0,
      changed: [],
      removed: 0,
      last: null,
    });
    const running = sweeper();
    let remaining = 2;

    setTimeout.mockImplementation(async () => {
      remaining -= 1;

      if (remaining === 0) {
        running.stop();
      }
    });

    running.start();

    await vi.waitFor(() => expect(setTimeout).toHaveBeenCalledTimes(2));

    expect(logger.error).toHaveBeenCalledWith(
      error,
      "Error sweeping record_search",
    );
    expect(sweepRecords).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(30_000, undefined, { ref: false });
  });
});
