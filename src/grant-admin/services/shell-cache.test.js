import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeBucket } from "../../common/buckets/catalogue.js";
import { config } from "../../common/config.js";
import { listBuckets } from "../../common/buckets/registry.js";
import { findCwBuckets } from "../repositories/cw-actuators.repository.js";
import {
  CW_TIMEOUT_MS,
  FAILED_MS,
  clearShellCache,
  mayBeCwList,
  readShell,
} from "./shell-cache.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/buckets/registry.js");
vi.mock("../../common/buckets/catalogue.js", async (importOriginal) => ({
  ...(await importOriginal()),
  describeBucket: vi.fn(),
}));
vi.mock("../repositories/cw-actuators.repository.js");

const STORED = "stored";

const ownBucket = {
  id: "gas.inbox",
  path: "events/gas/inbox",
  label: "GAS Inbox",
  service: "gas",
  shortLabel: "Inbox",
  icon: null,
  order: 20,
  noun: { one: "event", many: "events" },
  time: { label: "Created" },
  facts: {
    status: { param: "status", label: "Status", values: STORED, within: [] },
  },
  refs: {},
  lead: [],
  indexes: [],
  groupings: ["status"],
  title: { label: "Event", format: "id" },
  columns: [],
  audited: true,
  timeline: false,
  summaries: [],
  page: null,
  tab: null,
};

const entry = (id, order) => ({ id, order });

const MINUTE = 60_000;

describe("readShell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    clearShellCache();
    config.adminShellCacheMs = MINUTE;
    listBuckets.mockReturnValue([ownBucket]);
    describeBucket.mockResolvedValue(entry("gas.inbox", 20));
    findCwBuckets.mockResolvedValue([entry("cw.outbox", 10)]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers both services' entries in order, reading Caseworking within its own timeout", async () => {
    expect(await readShell()).toEqual({
      catalogue: {
        buckets: [entry("cw.outbox", 10), entry("gas.inbox", 20)],
        sourceErrors: [],
      },
    });
    expect(findCwBuckets).toHaveBeenCalledWith({ timeout: CW_TIMEOUT_MS });
  });

  it("shares one read between requests that arrive during it", async () => {
    const [first, second] = await Promise.all([readShell(), readShell()]);

    expect(second).toBe(first);
    expect(describeBucket).toHaveBeenCalledTimes(1);
    expect(findCwBuckets).toHaveBeenCalledTimes(1);
  });

  it("answers a kept catalogue at once and reads it again behind it once it is stale", async () => {
    const kept = await readShell();

    vi.advanceTimersByTime(MINUTE - 1);
    expect(await readShell()).toBe(kept);
    expect(findCwBuckets).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    findCwBuckets.mockResolvedValue([entry("cw.inbox", 30)]);

    expect(await readShell()).toBe(kept);
    expect(findCwBuckets).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();

    expect((await readShell()).catalogue.buckets.map(({ id }) => id)).toEqual([
      "gas.inbox",
      "cw.inbox",
    ]);
  });

  it("names Caseworking and keeps GAS's entries when it cannot be read, for 10 seconds", async () => {
    findCwBuckets.mockRejectedValue(new Error("down"));

    expect(await readShell()).toEqual({
      catalogue: {
        buckets: [entry("gas.inbox", 20)],
        sourceErrors: [{ hop: "CW-BE" }],
      },
    });

    vi.advanceTimersByTime(FAILED_MS - 1);
    await readShell();
    expect(findCwBuckets).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await readShell();
    expect(findCwBuckets).toHaveBeenCalledTimes(2);
  });

  it("offers no stored values for a GAS bucket whose values cannot be read, for 10 seconds", async () => {
    describeBucket.mockRejectedValue(new Error("timed out"));

    const [own] = (await readShell()).catalogue.buckets.filter(
      ({ id }) => id === "gas.inbox",
    );

    expect(own.facts).toEqual([
      expect.objectContaining({ name: "status", values: null }),
    ]);
    expect(own.groupings).toEqual([]);

    vi.advanceTimersByTime(FAILED_MS);
    await readShell();
    expect(describeBucket).toHaveBeenCalledTimes(2);
  });

  it("answers null when the catalogue cannot be built, and keeps nothing", async () => {
    listBuckets.mockImplementation(() => {
      throw new Error("no registry");
    });

    expect(await readShell()).toBeNull();

    listBuckets.mockReturnValue([ownBucket]);

    expect(await readShell()).not.toBeNull();
  });

  it("keeps the last good catalogue when a read behind it cannot be built", async () => {
    const kept = await readShell();

    vi.advanceTimersByTime(MINUTE);
    listBuckets.mockImplementation(() => {
      throw new Error("no registry");
    });
    await readShell();
    await vi.runAllTimersAsync();

    expect(await readShell()).toBe(kept);
  });

  it("answers null when a cold read passes its deadline, and keeps the read once it ends", async () => {
    findCwBuckets.mockReturnValue(
      new Promise((resolve) => {
        setTimeout(() => resolve([entry("cw.outbox", 10)]), 2 * CW_TIMEOUT_MS);
      }),
    );

    const answer = readShell(Date.now() + CW_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(CW_TIMEOUT_MS);

    expect(await answer).toBeNull();

    await vi.advanceTimersByTimeAsync(CW_TIMEOUT_MS);

    expect((await readShell()).catalogue.buckets).toHaveLength(2);
  });

  it("answers a cold read that ends before its deadline", async () => {
    expect(
      (await readShell(Date.now() + CW_TIMEOUT_MS)).catalogue.sourceErrors,
    ).toEqual([]);
  });

  it("answers the last catalogue when its own read passes the deadline and nothing is kept for long", async () => {
    config.adminShellCacheMs = 0;
    const last = await readShell();
    findCwBuckets.mockReturnValue(new Promise(() => {}));

    const answer = readShell(Date.now() + CW_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(CW_TIMEOUT_MS);

    expect(await answer).toBe(last);
  });

  it("waits for its own read when nothing is kept", async () => {
    config.adminShellCacheMs = 0;

    await readShell();
    findCwBuckets.mockResolvedValue([entry("cw.inbox", 30)]);

    expect((await readShell()).catalogue.buckets.map(({ id }) => id)).toEqual([
      "gas.inbox",
      "cw.inbox",
    ]);
  });
});

describe("mayBeCwList", () => {
  beforeEach(() => {
    clearShellCache();
    config.adminShellCacheMs = MINUTE;
    listBuckets.mockReturnValue([ownBucket]);
    describeBucket.mockResolvedValue(entry("gas.inbox", 20));
  });

  it("may be any path before Caseworking's lists have been read", async () => {
    findCwBuckets.mockRejectedValue(new Error("down"));
    await readShell();

    expect(mayBeCwList("cases")).toBe(true);
    expect(mayBeCwList("events/gas/nothing")).toBe(true);
  });

  it("is a path Caseworking last listed, even once it cannot be read", async () => {
    findCwBuckets.mockResolvedValue([
      { ...entry("cw.tasks", 40), path: "tasks" },
    ]);
    await readShell();

    config.adminShellCacheMs = 0;
    findCwBuckets.mockRejectedValue(new Error("down"));
    const shell = await readShell();

    expect(shell.catalogue.sourceErrors).toEqual([{ hop: "CW-BE" }]);
    expect(mayBeCwList("tasks")).toBe(true);
    expect(mayBeCwList("cases")).toBe(false);
  });

  it("forgets a list Caseworking no longer lists", async () => {
    findCwBuckets.mockResolvedValue([
      { ...entry("cw.tasks", 40), path: "tasks" },
    ]);
    await readShell();

    config.adminShellCacheMs = 0;
    findCwBuckets.mockResolvedValue([
      { ...entry("cw.cases", 30), path: "cases" },
    ]);
    await readShell();

    expect(mayBeCwList("cases")).toBe(true);
    expect(mayBeCwList("tasks")).toBe(false);
  });
});
