import { describe, expect, it } from "vitest";
import { shapeValue } from "./evaluate.js";
import { checkPart } from "./large-answers.js";

const row = (n) => ({
  key: { t: "2026-10-13T10:00:00.000Z", i: `${n}` },
  open: { kind: "case", code: "w", ref: `r${n}` },
  cells: { ref: `r${n}`, n, list: ["a", 1], none: null },
  order: null,
});

const part = (rows, groups = null) => ({
  read: "exact",
  boxes: [
    {
      id: "cw.cases",
      rows,
      to: null,
      end: true,
      count: { n: rows.length, capped: false },
    },
  ],
  groups,
});

const failure = (promise) =>
  promise.then(
    () => null,
    (error) => error,
  );

describe("checkPart", () => {
  it("reads a part of 5,000 rows, its rows as they were", async () => {
    const rows = Array.from({ length: 5000 }, (_, n) => row(n));

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads lists inside lists, 8 deep, in each of 20 cells", async () => {
    const deep = [[[[[[[["a", null]]]]]]], 1];
    const cells = Object.fromEntries(
      Array.from({ length: 20 }, (_, n) => [`c${n}`, deep]),
    );
    const rows = [{ ...row(0), cells, order: [1, [2]] }];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads an order cut short, and an exact decimal", async () => {
    const rows = [
      { ...row(1), order: { x: "9007199254740993" } },
      {
        ...row(0),
        order: {
          k: [
            ["a", 1],
            ["…", { c: true }],
          ],
        },
      },
    ];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads an object's cell as its text, alone or in a list", async () => {
    const rows = [
      { ...row(0), cells: { x: { text: "{ a: 1 }" }, y: [{ text: "{}" }] } },
    ];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads the deepest list a cell shows, and no deeper", async () => {
    const nested = (depth) =>
      Array.from({ length: depth }).reduce((inner) => [inner], "a");
    const shown = shapeValue(nested(12));
    const cellOf = (value) => [{ ...row(0), cells: { x: value } }];

    expect((await checkPart(part(cellOf(shown)))).boxes[0].rows).toEqual(
      cellOf(shown),
    );
    expect(await failure(checkPart(part(cellOf([shown]))))).toMatchObject({
      details: [{ path: ["boxes", 0, "rows", 0], type: "item" }],
    });
  });

  it("reads groups", async () => {
    const groups = [
      { key: "a", value: "A", n: 2, aggs: { "count(*)": 2, "max(x)": null } },
    ];

    expect((await checkPart(part([], groups))).groups).toEqual(groups);
  });

  it("reads values sent typed, to sort and merge by", async () => {
    const typed = [
      { n: "NaN" },
      { b: true },
      { d: "2026-10-01T00:00:00.000Z" },
      { o: "65f000000000000000000001" },
      { k: [["a", [1, { b: false }]]] },
    ];
    const rows = typed.map((order, n) => ({ ...row(n), order }));
    const groups = [
      { key: "a", value: { b: true }, n: 1, aggs: { "sum(x)": [1.5, 0] } },
    ];

    expect((await checkPart(part(rows, groups))).groups).toEqual(groups);
  });

  it.each([
    ["two tags", { b: true, d: "2026-10-01" }],
    ["an unknown tag", { x: 1 }],
    ["a boolean that isn't one", { b: "true" }],
    ["a time that isn't one", { d: "soon" }],
    ["an id that isn't one", { o: "zz" }],
    ["a number that isn't one", { n: "1" }],
    ["an object's entry that isn't a pair", { k: [["a"]] }],
    [
      "an object 20 deep",
      Array.from({ length: 20 }).reduce((inner) => ({ k: [["a", inner]] }), 1),
    ],
  ])("refuses an order of %s", async (_, order) => {
    const error = await failure(checkPart(part([{ ...row(0), order }])));

    expect(error.details).toEqual([
      { path: ["boxes", 0, "rows", 0], type: "item" },
    ]);
  });

  it.each([
    ["a cell that is an object", { ...row(1), cells: { x: { $gt: "" } } }],
    ["an order of no decimal", { ...row(1), order: { x: "abc" } }],
    [
      "an order of too many digits",
      { ...row(1), order: { x: `${"1".repeat(40)}e0` } },
    ],
    [
      "an order of a decimal out of range",
      { ...row(1), order: { x: "1e9999" } },
    ],
    [
      "an object's cell with more than its text",
      { ...row(1), cells: { x: { text: "{}", more: 1 } } },
    ],
    ["a list 10 deep", { ...row(1), cells: { x: [[[[[[[[[["a"]]]]]]]]]] } }],
    ["a key without an id", { ...row(1), key: { t: null } }],
    ["an open that isn't an object", { ...row(1), open: "x" }],
    ["a row that isn't an object", "row"],
  ])("refuses %s, naming where", async (_, bad) => {
    const error = await failure(checkPart(part([row(0), bad])));

    expect(error.details).toEqual([
      { path: ["boxes", 0, "rows", 1], type: "item" },
    ]);
  });

  it("refuses what the schema refuses outside the rows", async () => {
    expect(
      await failure(checkPart({ ...part([]), read: "sideways" })),
    ).toMatchObject({
      details: [expect.objectContaining({ path: ["read"] })],
    });
  });

  it("refuses a group it can't read", async () => {
    const error = await failure(
      checkPart(part([], [{ key: {}, value: "A", n: 1, aggs: {} }])),
    );

    expect(error.details).toEqual([{ path: ["groups", 0], type: "item" }]);
  });
});
