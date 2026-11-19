import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearListGroups,
  registerListGroup,
} from "../../../common/list-groups/registry.js";
import { eventListGroups } from "../../../events/lists/event-list-groups.js";
import { encodeGroupCursor } from "./cursor.js";
import { groupReaderFor } from "./reader.js";
import { eventViews } from "./test-groups.js";
import { aFakeBox, referenceOf, walkOf, walkProblems } from "./test-walks.js";

const BASE = Date.parse("2026-10-15T00:00:00.000Z");
const OUTBOX = "gas.outbox";
const INBOX = "gas.inbox";

let gas;

const at = (ms) => new Date(BASE - ms).toISOString();

const hex = (n) => n.toString(16).padStart(24, "0");

const BY_SECOND = { ms: (n) => n * 1000, id: hex };

const rowsAt = (count, shape = {}) => {
  const { ms, id, ...rest } = { ...BY_SECOND, ...shape };

  return Array.from({ length: count }, (_, n) => ({
    t: at(ms(n)),
    i: id(n),
    ...rest,
  }));
};

const BUCKETS = { outbox: OUTBOX, inbox: INBOX };

// A reader over in-memory boxes, each read recorded as the list reads it.
const readerOver = (boxes, options = {}) => {
  const { plans, where, ask } = { plans: {}, where: {}, ask: {}, ...options };
  const fakes = Object.fromEntries(
    Object.entries(boxes).map(([bucket, rows]) => [
      bucket,
      aFakeBox(bucket, rows, plans[bucket]),
    ]),
  );
  const readMember = vi.fn(async ({ bucketId, fields }) =>
    fakes[bucketId](fields),
  );

  return {
    readMember,
    reader: groupReaderFor({
      view: gas,
      where,
      ask: { search: null, repeat: false, count: true, ...ask },
      deadline: 123,
      readMember,
    }),
  };
};

const walkProblemsOf = async (boxes, options) => {
  const { reader } = readerOver(boxes, options);
  const pages = await walkOf(reader);

  return walkProblems(pages, referenceOf(boxes), (value) => BUCKETS[value]);
};

const idsOf = ({ rows }) => rows.map(({ cells, id }) => `${cells.box}:${id}`);

beforeEach(() => {
  clearListGroups();
  eventListGroups().forEach(registerListGroup);
  gas = eventViews().get("gas.events");
});

describe("a group's first page", () => {
  it("writes each row's member value in the cell its pick names", async () => {
    gas = { ...gas, pick: { ...gas.pick, name: "queue" } };
    const { reader } = readerOver({ [OUTBOX]: rowsAt(1), [INBOX]: [] });

    const answer = await reader.first(true);

    expect(answer.rows[0].cells).toEqual({
      status: "COMPLETED",
      queue: "outbox",
    });
  });

  it("merges both boxes newest first, each row naming its queue", async () => {
    const { reader } = readerOver({
      [OUTBOX]: rowsAt(2, { ms: (n) => n * 2000 }),
      [INBOX]: rowsAt(2, { ms: (n) => n * 2000 + 1000, id: (n) => hex(n + 8) }),
    });

    const answer = await reader.first(true);

    expect(idsOf(answer)).toEqual([
      `outbox:${hex(0)}`,
      `inbox:${hex(8)}`,
      `outbox:${hex(1)}`,
      `inbox:${hex(9)}`,
    ]);
    expect(answer.rows[0]).toEqual({
      id: hex(0),
      time: at(0),
      title: "Event",
      subtitle: null,
      cells: { status: "COMPLETED", box: "outbox" },
      link: null,
    });
    expect(answer).toMatchObject({
      bucket: "gas.events",
      plan: {
        kind: "exact",
        index: [],
        bound: ["status"],
        filled: [],
        residual: [],
        scans: 2,
      },
      page: { next: null, keepLooking: null, searchedTo: null, complete: true },
      groups: [],
      total: { count: 4, capped: false },
      queues: { limited: [], waiting: [] },
    });
  });

  it("reads each box with its own filters, the search and the count, as the list asked", async () => {
    const { reader, readMember } = readerOver(
      { [OUTBOX]: [], [INBOX]: [] },
      {
        where: { eventType: ["Audit", "CaseStatusUpdated"] },
        ask: { search: "ref:abc", repeat: true },
      },
    );

    await reader.first(true);

    expect(
      readMember.mock.calls.map(([{ bucketId, where, fields, repeat }]) => [
        bucketId,
        where,
        fields,
        repeat,
      ]),
    ).toEqual([
      [OUTBOX, { eventType: "Audit" }, { ref: "ref:abc", count: true }, true],
      [
        INBOX,
        { eventType: "CaseStatusUpdated" },
        { ref: "ref:abc", count: true },
        true,
      ],
    ]);
    expect(readMember.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("reads the list again from the start, with no search, not as a repeat", async () => {
    const { reader, readMember } = readerOver(
      { [OUTBOX]: rowsAt(1), [INBOX]: [] },
      { ask: { search: "ref:abc", repeat: true } },
    );

    await reader.first(false);

    expect(
      readMember.mock.calls.map(([{ where, fields, repeat }]) => [
        where,
        fields,
        repeat,
      ]),
    ).toEqual([
      [{}, { count: true }, false],
      [{}, { count: true }, false],
    ]);
  });

  it("reads nothing for an event outside the picked queue, and answers an empty, complete list", async () => {
    const { reader, readMember } = readerOver(
      { [OUTBOX]: rowsAt(3), [INBOX]: rowsAt(3) },
      { where: { box: "inbox", eventType: "Audit" } },
    );

    expect(await reader.first(true)).toEqual({
      bucket: "gas.events",
      plan: {
        kind: "exact",
        index: [],
        bound: [],
        filled: [],
        residual: [],
        scans: 1,
      },
      rows: [],
      page: { next: null, keepLooking: null, searchedTo: null, complete: true },
      groups: [],
      total: { count: 0, capped: false },
      queues: { limited: [], waiting: [] },
    });
    expect(readMember).not.toHaveBeenCalled();
  });

  it("counts nothing when not asked to", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: rowsAt(1), [INBOX]: [] },
      { ask: { count: undefined } },
    );

    expect(await reader.first(true)).not.toHaveProperty("total");
  });
});

describe("a group's total", () => {
  const many = (n) => rowsAt(n, { ms: (k) => k });

  it("adds the boxes' exact totals, past the cap too", async () => {
    const { reader } = readerOver({
      [OUTBOX]: many(9_000),
      [INBOX]: many(2_000),
    });

    expect((await reader.first(true)).total).toEqual({
      count: 11_000,
      capped: false,
    });
  });

  it("is capped when a box's is", async () => {
    const { reader } = readerOver({ [OUTBOX]: many(10_001), [INBOX]: many(1) });

    expect((await reader.first(true)).total).toEqual({
      count: 10_000,
      capped: true,
    });
  });

  it("counts a box the address rules out as none", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: many(5), [INBOX]: many(7) },
      { where: { eventType: "CaseStatusUpdated" } },
    );

    expect((await reader.first(true)).total).toEqual({
      count: 7,
      capped: false,
    });
  });

  it("is null when a box read bounded", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: many(5), [INBOX]: many(7) },
      { plans: { [INBOX]: { kind: "bounded", budget: 3 } } },
    );

    expect((await reader.first(true)).total).toBeNull();
  });
});

describe("a group's later pages", () => {
  it("goes on from each box's own position, counting nothing, as a repeat", async () => {
    const { reader, readMember } = readerOver({
      [OUTBOX]: rowsAt(30),
      [INBOX]: rowsAt(30, {
        ms: (n) => n * 1000 + 500,
        id: (n) => hex(n + 100),
      }),
    });
    const first = await reader.first(true);
    readMember.mockClear();

    const second = await reader.later(first.page.next);

    expect(
      readMember.mock.calls.map(([{ bucketId, fields, repeat }]) => [
        bucketId,
        Object.keys(fields),
        repeat,
      ]),
    ).toEqual([
      [OUTBOX, ["ref", "cursor", "count"], true],
      [INBOX, ["ref", "cursor", "count"], true],
    ]);
    expect(readMember.mock.calls[0][0].fields.count).toBeUndefined();
    expect(second.rows).toHaveLength(20);
    expect(second).not.toHaveProperty("total");
  });

  it("reads a box no more once it has shown all its rows", async () => {
    const { reader, readMember } = readerOver({
      [OUTBOX]: rowsAt(40),
      [INBOX]: rowsAt(2, { ms: () => 500, id: (n) => hex(n + 100) }),
    });
    const first = await reader.first(true);
    readMember.mockClear();

    await reader.later(first.page.next);

    expect(readMember.mock.calls.map(([{ bucketId }]) => bucketId)).toEqual([
      OUTBOX,
    ]);
  });

  it("answers the same page from a cursor in the address as from the walk", async () => {
    const boxes = {
      [OUTBOX]: rowsAt(50),
      [INBOX]: rowsAt(50, { ms: (n) => n * 700, id: (n) => hex(n + 100) }),
    };
    const pages = await walkOf(readerOver(boxes).reader);
    const { reader } = readerOver(boxes, {
      ask: { cursor: pages[1].page.next, count: undefined },
    });

    expect(await reader.first(true)).toEqual(pages[2]);
  });

  it("refuses a cursor it can't read before reading anything, search or not", () => {
    const run = () =>
      readerOver(
        { [OUTBOX]: [], [INBOX]: [] },
        { ask: { cursor: "bad", search: "ref:abc" } },
      );

    expect(run).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          payload: expect.objectContaining({ reason: "INVALID_CURSOR" }),
        }),
      }),
    );
  });

  it("ignores the position of a box the address no longer reads", async () => {
    const cursor = encodeGroupCursor({
      positions: { [OUTBOX]: { t: at(5000), i: hex(5) }, [INBOX]: null },
      bounded: [],
    });
    const { reader, readMember } = readerOver(
      { [OUTBOX]: rowsAt(10), [INBOX]: [] },
      { where: { eventType: "CreateCase" }, ask: { cursor } },
    );

    const answer = await reader.first(true);

    expect(readMember.mock.calls.map(([{ bucketId }]) => bucketId)).toEqual([
      OUTBOX,
    ]);
    expect(answer.rows.map(({ id }) => id)).toEqual([6, 7, 8, 9].map(hex));
  });
});

describe("a bounded box beside an exact one", () => {
  const boxes = {
    [OUTBOX]: rowsAt(40, { ms: (n) => n * 100, match: false }),
    [INBOX]: rowsAt(5, { ms: (n) => n * 1000 + 50, id: (n) => hex(n + 100) }),
  };
  const plans = { [OUTBOX]: { kind: "bounded", budget: 10 } };

  it("shows only the rows down to the bounded box's window, and says which queue holds the rest back", async () => {
    const { reader } = readerOver(boxes, { plans });

    const answer = await reader.first(true);

    expect(answer.rows.map(({ id }) => id)).toEqual([hex(100)]);
    expect(answer.page).toEqual({
      next: null,
      keepLooking: expect.any(String),
      searchedTo: at(900),
      complete: false,
    });
    expect(answer.queues).toEqual({ limited: ["outbox"], waiting: ["inbox"] });
    expect(answer.plan.kind).toBe("bounded");
    expect(answer.total).toBeNull();
  });

  it("stays bounded once the bounded box has ended, and walks every row in order", async () => {
    const { reader } = readerOver(boxes, { plans });

    const pages = await walkOf(reader);

    expect(pages.at(-1).plan.kind).toBe("bounded");
    expect(pages.at(-1).plan.scans).toBeGreaterThanOrEqual(1);
    expect(
      walkProblems(pages, referenceOf(boxes), (value) => BUCKETS[value]),
    ).toEqual([]);
  });

  it("is bounded while a bounded box still has a page of rows inside its window", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: rowsAt(40), [INBOX]: rowsAt(3, { id: (n) => hex(n + 100) }) },
      { plans: { [OUTBOX]: { kind: "bounded", budget: 30 } } },
    );

    const first = await reader.first(true);
    const second = await reader.later(first.page.next);

    expect(first.page.next).not.toBeNull();
    expect(first).toMatchObject({ plan: { kind: "bounded" }, total: null });
    expect(second.plan.kind).toBe("bounded");
  });

  it("names no waiting queue when the other box has nothing past the window", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: boxes[OUTBOX], [INBOX]: rowsAt(1, { ms: () => 50 }) },
      { plans },
    );

    expect((await reader.first(true)).queues).toEqual({
      limited: ["outbox"],
      waiting: [],
    });
  });
});

describe("a box that fails", () => {
  it("fails the page, naming its queue, and stops the other reads", async () => {
    const signals = [];
    const readMember = vi.fn(({ bucketId, signal }) => {
      signals.push(signal);

      return bucketId === INBOX
        ? Promise.reject(Boom.gatewayTimeout("late"))
        : new Promise(() => {});
    });
    const reader = groupReaderFor({
      view: gas,
      where: {},
      ask: { search: null, repeat: false },
      deadline: 1,
      readMember,
    });

    const error = await reader.first(true).catch((caught) => caught);

    expect(error.output).toMatchObject({
      statusCode: 504,
      payload: { queue: "inbox" },
    });
    expect(signals.every(({ aborted }) => aborted)).toBe(true);
  });

  it("names the queue of a failure that is no HTTP error", async () => {
    const reader = groupReaderFor({
      view: gas,
      where: { box: "outbox" },
      ask: { search: null, repeat: false },
      deadline: 1,
      readMember: () => Promise.reject(new Error("socket closed")),
    });

    const error = await reader.first(true).catch((caught) => caught);

    expect(error.output).toMatchObject({
      statusCode: 500,
      payload: { queue: "outbox" },
    });
  });
});

describe("a group's search", () => {
  it.each([
    ["a link kind only the inboxes read by", "config:woodland@1.0.0", {}],
    ["a blank value", "ref:  ", {}],
    [
      "a link kind, with every box ruled out",
      "config:x",
      { box: "inbox", eventType: "Audit" },
    ],
  ])("refuses %s before reading any box", async (_, search, where) => {
    const { reader, readMember } = readerOver(
      { [OUTBOX]: [], [INBOX]: [] },
      { where, ask: { search } },
    );

    await expect(reader.first(true)).rejects.toMatchObject({
      output: { payload: { reason: "UNKNOWN_REF_KIND" } },
    });
    expect(readMember).not.toHaveBeenCalled();
  });

  it("answers a search of a kind it offers with every box ruled out as an empty list", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: [], [INBOX]: [] },
      {
        where: { box: "inbox", eventType: "Audit" },
        ask: { search: "ref:abc" },
      },
    );

    expect((await reader.first(true)).rows).toEqual([]);
  });

  it("refuses the search on a later page too", async () => {
    const { reader } = readerOver(
      { [OUTBOX]: rowsAt(30), [INBOX]: [] },
      { ask: { search: "config:x" } },
    );
    const first = await reader.first(false);

    await expect(reader.later(first.page.next)).rejects.toMatchObject({
      output: { payload: { reason: "UNKNOWN_REF_KIND" } },
    });
  });
});

// Fixed cases and random walks, each walked to its end and compared with a
// direct sort.
describe("walking a group to its end", () => {
  it("shows 60 rows at one millisecond, the same ids in both boxes, inbox first", async () => {
    const same = rowsAt(30, { ms: () => 0 });

    expect(
      await walkProblemsOf({
        [OUTBOX]: same,
        [INBOX]: same.map((row) => ({ ...row })),
      }),
    ).toEqual([]);
  });

  const tie = () => ({
    [OUTBOX]: rowsAt(5, { ms: () => 1 }),
    [INBOX]: [
      ...rowsAt(19, { ms: () => 0 }),
      ...rowsAt(5, { ms: () => 1, id: (n) => `f${hex(n).slice(1)}` }),
    ],
  });

  it.each([
    ["both exact", {}],
    ["the outbox bounded", { [OUTBOX]: { kind: "bounded", budget: 2 } }],
    ["the inbox bounded", { [INBOX]: { kind: "bounded", budget: 3 } }],
  ])("cuts a page inside a tie across boxes, %s", async (_, plans) => {
    expect(await walkProblemsOf(tie(), { plans })).toEqual([]);
  });

  it("walks a window one box has nothing in", async () => {
    expect(await walkProblemsOf({ [OUTBOX]: [], [INBOX]: rowsAt(45) })).toEqual(
      [],
    );
  });

  it.each([1, 2, 3, 4])(
    "matches a random walk of the boxes (seed %i)",
    async (seedNumber) => {
      let seed = seedNumber;
      const rand = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;

        return seed / 2 ** 31;
      };
      const pick = (n) => Math.floor(rand() * n);

      for (let k = 0; k < 40; k++) {
        const times = 1 + pick(k % 3 === 0 ? 4 : 60);
        const box = (plan) =>
          Array.from({ length: pick(120) }, () => {
            const candidate = plan.kind === "exact" || rand() < 0.9;

            return {
              t: at(pick(times)),
              i: hex(pick(300)),
              candidate,
              match: candidate && rand() < [0.05, 0.5, 1][pick(3)],
            };
          }).filter(
            (row, n, all) => all.findIndex(({ i }) => i === row.i) === n,
          );
        const plan = () =>
          rand() < 0.5
            ? { kind: "exact" }
            : { kind: "bounded", budget: 1 + pick(k % 2 ? 6 : 45) };
        const plans = { [OUTBOX]: plan(), [INBOX]: plan() };
        const boxes = {
          [OUTBOX]: box(plans[OUTBOX]),
          [INBOX]: box(plans[INBOX]),
        };

        expect(await walkProblemsOf(boxes, { plans })).toEqual([]);
      }
    },
  );
});
