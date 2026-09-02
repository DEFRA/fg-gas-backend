import { describe, expect, it } from "vitest";
import { SOURCE_KEYS, sortKeyFor } from "./event-cursor.js";
import {
  PAGE_SIZE,
  buildPagination,
  compareDesc,
  mergePages,
} from "./merge-event-pages.js";

const SERVICE_OF = {
  gasInbox: "gas",
  gasOutbox: "gas",
  cwInbox: "caseworking",
  cwOutbox: "caseworking",
};

const BOX_OF = {
  gasInbox: "inbox",
  gasOutbox: "outbox",
  cwInbox: "inbox",
  cwOutbox: "outbox",
};

const hexId = (n) => `665f1c2e9a1b2c3d4e5f${String(n).padStart(4, "0")}`;

const tuple = (key, n, createdAt) => {
  const cursorValue =
    createdAt ?? `2026-06-16T10:${String(n).padStart(2, "0")}:00.000Z`;

  return {
    key,
    order: cursorValue === null ? null : Date.parse(cursorValue),
    cursorValue,
    id: hexId(n),
    row: {
      service: SERVICE_OF[key],
      box: BOX_OF[key],
      id: hexId(n),
      createdAt: cursorValue,
    },
  };
};

const nullTuple = (key, n) => ({
  ...tuple(key, n),
  order: null,
  cursorValue: null,
});

const page = (key, tuples, pagination = {}) => ({
  key,
  tuples,
  pagination: {
    hasNextPage: false,
    hasPreviousPage: false,
    ...pagination,
  },
});

const emptySlices = () =>
  Object.fromEntries(SOURCE_KEYS.map((key) => [key, null]));

const decode = (cursor) =>
  JSON.parse(Buffer.from(cursor, "base64url").toString());

const sliceOf = (cursor, key) => decode(decode(cursor)[key]);

describe("compareDesc / mergePages", () => {
  it("orders rows from four sources newest first", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 1)]),
      page("gasOutbox", [tuple("gasOutbox", 4)]),
      page("cwInbox", [tuple("cwInbox", 2)]),
      page("cwOutbox", [tuple("cwOutbox", 3)]),
    ];

    const { events } = mergePages({ pages, direction: "forward" });

    expect(events.map((e) => e.createdAt)).toEqual([
      "2026-06-16T10:04:00.000Z",
      "2026-06-16T10:03:00.000Z",
      "2026-06-16T10:02:00.000Z",
      "2026-06-16T10:01:00.000Z",
    ]);
  });

  it("breaks a createdAt tie on service, then box, then _id descending", () => {
    const at = "2026-06-16T10:00:00.000Z";
    const pages = [
      page("cwOutbox", [tuple("cwOutbox", 1, at)]),
      page("cwInbox", [tuple("cwInbox", 2, at)]),
      page("gasOutbox", [tuple("gasOutbox", 3, at), tuple("gasOutbox", 4, at)]),
      page("gasInbox", [tuple("gasInbox", 5, at)]),
    ];

    const { events } = mergePages({ pages, direction: "forward" });

    expect(events.map((e) => `${e.service}/${e.box}/${e.id}`)).toEqual([
      `gas/inbox/${hexId(5)}`,
      `gas/outbox/${hexId(4)}`,
      `gas/outbox/${hexId(3)}`,
      `caseworking/inbox/${hexId(2)}`,
      `caseworking/outbox/${hexId(1)}`,
    ]);
  });

  it("orders rows with a null order key last", () => {
    const pages = [
      page("gasInbox", [nullTuple("gasInbox", 1), tuple("gasInbox", 2)]),
    ];

    const { taken } = mergePages({ pages, direction: "forward" });

    expect(taken.map((t) => t.order)).toEqual([
      Date.parse(tuple("gasInbox", 2).cursorValue),
      null,
    ]);
  });

  it("compares two null-order tuples by id descending", () => {
    expect(
      compareDesc(nullTuple("gasInbox", 1), nullTuple("gasInbox", 2)),
    ).toBeGreaterThan(0);
  });

  it("takes exactly 20 when 80 rows are offered", () => {
    const pages = SOURCE_KEYS.map((key) =>
      page(
        key,
        Array.from({ length: 20 }, (_, i) => tuple(key, i + 1)),
      ),
    );

    const { taken, events } = mergePages({ pages, direction: "forward" });

    expect(taken).toHaveLength(PAGE_SIZE);
    expect(events).toHaveLength(PAGE_SIZE);
  });

  it("backward takes the 20 closest to the cursor and returns them newest first", () => {
    const pages = [
      page(
        "gasInbox",
        Array.from({ length: 25 }, (_, i) => tuple("gasInbox", i + 1)),
      ),
    ];

    const { events } = mergePages({ pages, direction: "backward" });

    expect(events).toHaveLength(PAGE_SIZE);
    // The 20 oldest candidates (minutes 01..20), newest first.
    expect(events[0].createdAt).toEqual("2026-06-16T10:20:00.000Z");
    expect(events.at(-1).createdAt).toEqual("2026-06-16T10:01:00.000Z");
  });
});

describe("buildPagination", () => {
  const forward = (pages, overrides = {}) => {
    const { taken } = mergePages({ pages, direction: "forward" });

    return buildPagination({
      slices: emptySlices(),
      pages,
      taken,
      direction: "forward",
      hadCursor: false,
      ...overrides,
    });
  };

  it("startCursor slice is the newest row taken from each source", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 3), tuple("gasInbox", 1)]),
    ];

    const pagination = forward(pages);

    expect(sliceOf(pagination.startCursor, "gasInbox")).toEqual({
      [sortKeyFor("gasInbox")]: "2026-06-16T10:03:00.000Z",
      _id: hexId(3),
    });
  });

  it("endCursor slice is the oldest row taken from each source", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 3), tuple("gasInbox", 1)]),
    ];

    const pagination = forward(pages);

    expect(sliceOf(pagination.endCursor, "gasInbox")).toEqual({
      [sortKeyFor("gasInbox")]: "2026-06-16T10:01:00.000Z",
      _id: hexId(1),
    });
  });

  it("a source that contributed no rows keeps its incoming slice in both cursors", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 3)]),
      page("cwInbox", []),
    ];
    const incoming = { ...emptySlices(), cwInbox: "INCOMING-CW-INBOX" };
    const { taken } = mergePages({ pages, direction: "forward" });

    const pagination = buildPagination({
      slices: incoming,
      pages,
      taken,
      direction: "forward",
      hadCursor: true,
    });

    expect(decode(pagination.startCursor).cwInbox).toEqual("INCOMING-CW-INBOX");
    expect(decode(pagination.endCursor).cwInbox).toEqual("INCOMING-CW-INBOX");
  });

  it("a source absent from pages (failed) keeps its incoming slice", () => {
    const pages = [page("gasInbox", [tuple("gasInbox", 3)])];
    const incoming = { ...emptySlices(), gasOutbox: "INCOMING-GAS-OUTBOX" };
    const { taken } = mergePages({ pages, direction: "forward" });

    const pagination = buildPagination({
      slices: incoming,
      pages,
      taken,
      direction: "forward",
      hadCursor: false,
    });

    expect(decode(pagination.endCursor).gasOutbox).toEqual(
      "INCOMING-GAS-OUTBOX",
    );
  });

  it("hasNextPage is true when one source has untaken rows even though every source's look-ahead is false", () => {
    const pages = SOURCE_KEYS.map((key) =>
      page(
        key,
        Array.from({ length: 10 }, (_, i) => tuple(key, i + 1)),
      ),
    );

    expect(forward(pages).hasNextPage).toBe(true);
  });

  it("hasNextPage is true when a source's own hasNextPage is true and all its rows were taken", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 1)], { hasNextPage: true }),
    ];

    expect(forward(pages).hasNextPage).toBe(true);
  });

  it("hasNextPage is false when every source is exhausted", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 1)]),
      page("gasOutbox", [tuple("gasOutbox", 2)]),
    ];

    expect(forward(pages).hasNextPage).toBe(false);
  });

  it("hasPreviousPage forward is false without an incoming cursor and true with one", () => {
    const pages = [page("gasInbox", [tuple("gasInbox", 1)])];

    expect(forward(pages).hasPreviousPage).toBe(false);
    expect(forward(pages, { hadCursor: true }).hasPreviousPage).toBe(true);
  });

  it("backward reports hasNextPage true and derives hasPreviousPage from remaining rows", () => {
    const pages = [
      page(
        "gasInbox",
        Array.from({ length: 25 }, (_, i) => tuple("gasInbox", i + 1)),
      ),
    ];
    const { taken } = mergePages({ pages, direction: "backward" });

    const pagination = buildPagination({
      slices: emptySlices(),
      pages,
      taken,
      direction: "backward",
      hadCursor: true,
    });

    expect(pagination.hasNextPage).toBe(true);
    expect(pagination.hasPreviousPage).toBe(true);
  });

  it("backward slices point at the newest and oldest rows actually taken", () => {
    const pages = [
      page("gasInbox", [tuple("gasInbox", 1), tuple("gasInbox", 2)]),
    ];
    const { taken } = mergePages({ pages, direction: "backward" });

    const pagination = buildPagination({
      slices: emptySlices(),
      pages,
      taken,
      direction: "backward",
      hadCursor: true,
    });

    expect(sliceOf(pagination.startCursor, "gasInbox")._id).toEqual(hexId(2));
    expect(sliceOf(pagination.endCursor, "gasInbox")._id).toEqual(hexId(1));
  });

  it("an empty page returns null cursors and hasNextPage false (forward)", () => {
    const pages = [page("gasInbox", []), page("gasOutbox", [])];

    expect(forward(pages)).toEqual({
      startCursor: null,
      endCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it("three exhausted sources and one with more rows keeps hasNextPage true and the next endCursor advances only that source's slice", () => {
    const busy = Array.from({ length: 20 }, (_, i) => tuple("cwOutbox", i + 1));
    const pages = [
      page("gasInbox", [tuple("gasInbox", 30)]),
      page("gasOutbox", [tuple("gasOutbox", 31)]),
      page("cwInbox", [tuple("cwInbox", 32)]),
      page("cwOutbox", busy, { hasNextPage: true }),
    ];

    const { taken } = mergePages({ pages, direction: "forward" });
    const pagination = buildPagination({
      slices: emptySlices(),
      pages,
      taken,
      direction: "forward",
      hadCursor: false,
    });

    expect(pagination.hasNextPage).toBe(true);
    expect(sliceOf(pagination.endCursor, "gasInbox")._id).toEqual(hexId(30));
    // 3 of the 20 slots went to the other sources, so cwOutbox contributed
    // rows 20..4 and its endCursor slice points at the oldest one taken.
    expect(sliceOf(pagination.endCursor, "cwOutbox")._id).toEqual(hexId(4));
  });
});
