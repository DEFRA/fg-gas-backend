import { describe, expect, it } from "vitest";
import {
  compareRows,
  decodePositions,
  encodePositions,
  mergeExact,
  mergeGroups,
  mergeWindowed,
} from "./merge.js";
import { refusalOf } from "./refusal.js";

const id = (n) => n.toString(16).padStart(24, "0");
const at = (minute) =>
  `2026-10-13T10:${String(minute).padStart(2, "0")}:00.000Z`;
const row = (minute, n, order = null) => ({
  key: { t: at(minute), i: id(n) },
  open: null,
  cells: { n },
  order,
});
const box = (boxId, rows, to, end = false, count = null) => ({
  id: boxId,
  rows,
  to,
  end,
  count,
});

describe("mergeWindowed", () => {
  it("shows no row older than the newest window end, and each box goes on from there", () => {
    const merged = mergeWindowed(
      [
        box("gas.outbox", [row(50, 1), row(40, 2), row(20, 3)], {
          t: at(20),
          i: id(3),
        }),
        box("cw.inbox", [row(45, 4), row(30, 5)], { t: at(30), i: id(5) }),
      ],
      { limit: 50 },
    );

    expect(merged.rows.map(({ cells }) => cells.n)).toEqual([1, 4, 2, 5]);
    expect(merged.to).toBe(at(30));
    expect(merged.end).toBe(false);
    expect(merged.positions).toEqual({
      "gas.outbox": { t: at(30), i: "f".repeat(24) },
      "cw.inbox": { t: at(30), i: id(5) },
    });
  });

  it("goes on from the last row shown when the limit cuts the rows", () => {
    const merged = mergeWindowed(
      [
        box("gas.outbox", [row(50, 1), row(40, 2)], { t: at(40), i: id(2) }),
        box("gas.inbox", [row(45, 3)], null, true),
      ],
      { limit: 2 },
    );

    expect(merged.rows.map(({ cells }) => cells.n)).toEqual([1, 3]);
    expect(merged.positions).toEqual({
      "gas.outbox": { t: at(45), i: "f".repeat(24) },
      "gas.inbox": null,
    });
  });

  it("breaks a tie in time by box, then by the newest _id", () => {
    const merged = mergeWindowed(
      [
        box("gas.outbox", [row(10, 1)], null, true),
        box("cw.inbox", [row(10, 2), row(10, 3)], null, true),
      ],
      { limit: 50 },
    );

    expect(merged.rows.map(({ cells }) => cells.n)).toEqual([3, 2, 1]);
    expect(merged.rows[0]).toMatchObject({
      box: "cw.inbox",
      key: { i: id(3) },
    });
  });

  it("ends when every box has read to its oldest record and shown every row", () => {
    expect(
      mergeWindowed([box("gas.outbox", [row(1, 1)], null, true)], { limit: 5 }),
    ).toMatchObject({
      to: null,
      end: true,
      positions: { "gas.outbox": null },
    });
  });

  it("reads again a box that ended, when rows it read are not shown yet", () => {
    const merged = mergeWindowed(
      [
        box("gas.outbox", [row(50, 1)], { t: at(40), i: id(7) }),
        box("gas.inbox", [row(30, 2)], null, true),
      ],
      { limit: 50 },
    );

    expect(merged.rows).toHaveLength(1);
    expect(merged.positions["gas.inbox"]).toEqual({
      t: at(40),
      i: "0".repeat(24),
    });
  });
});

describe("mergeExact", () => {
  it("merges every box's rows newest first, keeps the limit, and adds the counts", () => {
    expect(
      mergeExact(
        [
          box("gas.outbox", [row(5, 1), row(3, 2)], null, true, {
            n: 2,
            capped: false,
          }),
          box("cw.outbox", [row(4, 3)], null, true, { n: 10000, capped: true }),
        ],
        { limit: 2, orderBy: null },
      ),
    ).toMatchObject({
      rows: [{ cells: { n: 1 } }, { cells: { n: 3 } }],
      count: { n: 10002, capped: true },
    });
  });

  it("sorts by the ORDER BY value as Mongo does, null lowest: first ascending, last descending", () => {
    const rows = [row(1, 1, 5), row(2, 2, null), row(3, 3, 9)];
    const sorted = (desc) =>
      [...rows]
        .sort(compareRows({ field: "area", fn: null, desc }))
        .map(({ cells }) => cells.n);

    expect(sorted(false)).toEqual([2, 1, 3]);
    expect(sorted(true)).toEqual([3, 1, 2]);
  });

  it("sorts lists element by element and mixed types by Mongo's type order", () => {
    const rows = [
      row(1, 1, [10]),
      row(2, 2, "text"),
      row(3, 3, [9]),
      row(4, 4, 2),
    ];

    expect(
      [...rows]
        .sort(compareRows({ field: "area", fn: null, desc: false }))
        .map(({ cells }) => cells.n),
    ).toEqual([4, 2, 3, 1]);
  });

  it("breaks ties the order's way, as each box reads them: oldest _id first ascending", () => {
    const tied = { d: at(5) };
    const rows = [row(5, 1, tied), row(5, 3, tied), row(5, 2, tied)];
    const sorted = (desc) =>
      [...rows]
        .sort(compareRows({ path: "created", fn: null, desc }))
        .map(({ cells }) => cells.n);

    expect(sorted(false)).toEqual([1, 2, 3]);
    expect(sorted(true)).toEqual([3, 2, 1]);
  });

  it("sorts booleans after text, as Mongo's type order has them", () => {
    const rows = [
      row(1, 1, { b: true }),
      row(2, 2, "z"),
      row(3, 3, { b: false }),
    ];

    expect(
      [...rows]
        .sort(compareRows({ path: "flag", fn: null, desc: false }))
        .map(({ cells }) => cells.n),
    ).toEqual([2, 3, 1]);
  });
});

describe("mergeGroups", () => {
  it("adds counts and sums of one key and keeps the extremes, in the order first met", () => {
    expect(
      mergeGroups([
        [
          {
            key: "a",
            value: "A",
            n: 2,
            aggs: {
              "sum(area)": [1.5, 0, 1.5, "f", null],
              "max(created)": at(1),
            },
          },
          {
            key: null,
            value: null,
            n: 1,
            aggs: { "sum(area)": null, "max(created)": null },
          },
        ],
        [
          {
            key: "a",
            value: "A",
            n: 3,
            aggs: {
              "sum(area)": [2, 0, 2, "i", null],
              "max(created)": at(9),
            },
          },
        ],
      ]),
    ).toEqual([
      {
        key: "a",
        value: "A",
        n: 5,
        aggs: { "sum(area)": [3.5, 0, 3.5, "f", null], "max(created)": at(9) },
      },
      {
        key: null,
        value: null,
        n: 1,
        aggs: { "sum(area)": null, "max(created)": null },
      },
    ]);
  });
});

describe("positions", () => {
  it("travel as one opaque text, and come back as they went", () => {
    const positions = {
      "gas.outbox": { t: at(1), i: id(1) },
      "cw.inbox": null,
    };

    expect(decodePositions(encodePositions(positions))).toEqual(positions);
  });

  it.each([
    ["not base64 JSON", "%%%"],
    ["a key that is no box", encodePositions({ $where: null })],
    [
      "a cursor with an operator",
      encodePositions({ "gas.outbox": { t: { $gt: "" }, i: id(1) } }),
    ],
    ["a proto key", Buffer.from('{"__proto__":{"x":1}}').toString("base64url")],
  ])("are refused when %s", (_, text) => {
    try {
      decodePositions(text);
      expect.unreachable();
    } catch (error) {
      expect(refusalOf(error)).toBe("BAD_POSITION");
    }
  });
});
