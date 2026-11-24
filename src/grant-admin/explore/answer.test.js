import { BSON, Double, Int32, Long } from "mongodb";
import { describe, expect, it } from "vitest";
import { elementsOf } from "../../common/explore/bson-bytes.js";
import { cellsAllowanceOf } from "../../common/explore/cells-allowance.js";
import { orderedOf } from "../../common/explore/evaluate.js";
import { decodePositions } from "../../common/explore/merge.js";
import {
  answerFrom,
  columnsOf,
  limitsOf,
  shownBy,
  unseenPaths,
} from "./answer.js";

const source = {
  name: "applications",
  noun: { one: "application", many: "applications" },
};

const query = (overrides = {}) => ({
  mode: "rows",
  columns: [{ path: "ref" }],
  where: null,
  unwind: [],
  groupBy: null,
  orderBy: null,
  limit: 50,
  ...overrides,
});

const id = (n) => n.toString(16).padStart(24, "0");
const row = (minute, n) => ({
  key: {
    t: `2026-10-13T10:${String(minute).padStart(2, "0")}:00.000Z`,
    i: id(n),
  },
  open: { kind: "application", code: "g", ref: `r${n}` },
  cells: { c0: `r${n}` },
  order: null,
});

describe("columnsOf", () => {
  const rows = (...cells) => cells.map((c) => ({ open: null, cells: c }));

  it("heads a column by its name, else its path, and says what its values are", () => {
    expect(
      columnsOf(
        query({
          columns: [
            { path: "clientRef" },
            { fn: "count", path: "phases.answers.parcels", as: "parcels" },
            { path: "createdAt", as: "created" },
            { path: "identifiers.sbi" },
            { path: "missing" },
          ],
        }),
        rows(
          {
            c0: "r1",
            c1: 2,
            c2: "2026-10-13T10:00:00.000Z",
            c3: ["1", 2],
            c4: null,
          },
          { c0: "r2", c1: 0, c2: "2026-10-13", c3: "3" },
        ),
      ),
    ).toEqual([
      {
        key: "c0",
        label: "clientRef",
        kind: "text",
        aggregate: false,
        path: "clientRef",
      },
      {
        key: "c1",
        label: "parcels",
        kind: "number",
        aggregate: true,
        path: null,
      },
      {
        key: "c2",
        label: "created",
        kind: "date",
        aggregate: false,
        path: null,
      },
      {
        key: "c3",
        label: "identifiers.sbi",
        kind: "text",
        aggregate: false,
        path: "identifiers.sbi",
      },
      {
        key: "c4",
        label: "missing",
        kind: "text",
        aggregate: false,
        path: "missing",
      },
    ]);
  });

  it("keeps a name as typed, never made into words", () => {
    expect(
      columnsOf(
        query({ columns: [{ path: "clientRef", as: "__proto__" }] }),
        [],
      )[0].label,
    ).toBe("__proto__");
  });

  it("heads a count count", () => {
    expect(
      columnsOf(
        query({ mode: "count", columns: [{ fn: "count", path: "*" }] }),
        rows({ c0: "10,000+" }),
      ),
    ).toEqual([
      { key: "c0", label: "count", kind: "text", aggregate: true, path: null },
    ]);
  });
});

describe("unseenPaths", () => {
  const known = {
    paths: new Map(
      [
        "clientRef",
        "identifiers.sbi",
        "phases.answers.parcels.parcelId",
        "agreements",
      ].map((path) => [path, { path }]),
    ),
  };

  it("names each path no suggested path is, nor above or below", () => {
    expect(
      unseenPaths(
        known,
        query({
          columns: [
            { path: "clientRef" },
            { path: "identifiers" },
            { path: "phases.answers.parcels.parcelId.x" },
            { path: "agreements.FPTT1.state" },
            { path: "phases.answers.parcel.parcelId" },
            { fn: "count", path: "*" },
          ],
          where: {
            any: [
              { path: "identifers.sbi", op: "eq", values: ["1"] },
              { path: "identifers.sbi", op: "eq", values: ["2"] },
            ],
          },
        }),
      ),
    ).toEqual(["identifers.sbi", "phases.answers.parcel.parcelId"]);
  });
});

describe("answerFrom", () => {
  it("answers an exact read with its rows and count", () => {
    const answer = answerFrom({
      source,
      query: query({ limit: 1 }),
      parts: [
        {
          read: "exact",
          groups: null,
          boxes: [
            {
              id: "gas.applications",
              rows: [row(5, 1), row(4, 2)],
              to: null,
              end: true,
              count: { n: 2, capped: false },
            },
          ],
        },
      ],
    });

    expect(answer).toEqual({
      source: { name: "applications", noun: "application" },
      mode: "rows",
      read: "exact",
      columns: [
        {
          key: "c0",
          label: "ref",
          kind: "text",
          aggregate: false,
          path: "ref",
        },
      ],
      rows: [
        {
          open: { kind: "application", code: "g", ref: "r1" },
          cells: { c0: "r1" },
        },
      ],
      count: { n: 2, capped: false },
      groups: false,
      unwound: false,
      partial: false,
      window: null,
    });
  });

  it("answers a windowed read with no count, and where to go on from", () => {
    const answer = answerFrom({
      source,
      query: query(),
      parts: [
        {
          read: "windowed",
          groups: null,
          boxes: [
            {
              id: "gas.applications",
              rows: [row(5, 1)],
              to: { t: row(3, 9).key.t, i: id(9) },
              end: false,
              count: null,
            },
          ],
        },
      ],
    });

    expect(answer).toMatchObject({
      read: "windowed",
      count: null,
      rows: [{ cells: { c0: "r1" } }],
    });
    expect(answer.window).toMatchObject({
      to: row(3, 9).key.t,
      end: false,
      skipped: [],
    });
    expect(decodePositions(answer.window.positions)).toEqual({
      "gas.applications": { t: row(3, 9).key.t, i: id(9) },
    });
  });

  it("answers groups most first, a missing value as (none), and records counted as the count", () => {
    const answer = answerFrom({
      source,
      query: query({
        columns: [{ path: "status" }, { fn: "count", path: "*" }],
        groupBy: { path: "status" },
      }),
      parts: [
        {
          read: "exact",
          boxes: [
            {
              id: "a.b",
              rows: [],
              to: null,
              end: true,
              count: { n: 6, capped: false },
            },
          ],
          groups: [
            { key: "a", value: "A", n: 1, aggs: { "count(*)": 1 } },
            { key: null, value: null, n: 2, aggs: { "count(*)": 2 } },
          ],
        },
        {
          read: "exact",
          boxes: [],
          groups: [{ key: "a", value: "A", n: 3, aggs: { "count(*)": 3 } }],
        },
      ],
    });

    expect(answer.rows).toEqual([
      { open: null, cells: { c0: "A", c1: 4 } },
      { open: null, cells: { c0: "(none)", c1: 2 } },
    ]);
    expect(answer).toMatchObject({
      groups: true,
      unwound: false,
      count: { n: 6, capped: false, groups: 2 },
    });
  });

  it("sorts groups by the ORDER BY aggregate", () => {
    const answer = answerFrom({
      source,
      query: query({
        columns: [{ path: "status" }, { fn: "sum", path: "area" }],
        mode: "groups",
        groupBy: { path: "status" },
        orderBy: { path: "area", fn: "sum", desc: false },
      }),
      parts: [
        {
          read: "full",
          boxes: [],
          groups: [
            {
              key: "a",
              value: "A",
              n: 1,
              aggs: { "sum(area)": [9, 0, 9, "i", null] },
            },
            {
              key: "b",
              value: "B",
              n: 5,
              aggs: { "sum(area)": [1, 0, 1, "i", null] },
            },
            { key: "c", value: "C", n: 5, aggs: { "sum(area)": null } },
          ],
        },
      ],
    });

    expect(answer.rows.map(({ cells }) => cells.c0)).toEqual(["C", "B", "A"]);
  });

  it("sorts groups by typed values, then shows them: a boolean after text, as Mongo orders them", () => {
    const answer = answerFrom({
      source,
      query: query({
        columns: [{ path: "status" }, { fn: "max", path: "area" }],
        mode: "groups",
        groupBy: { path: "status" },
        orderBy: { path: "status", fn: null, desc: false },
      }),
      parts: [
        {
          read: "full",
          boxes: [],
          groups: [
            {
              key: "t",
              value: { b: true },
              n: 1,
              aggs: { "max(area)": { k: [] } },
            },
            {
              key: "z",
              value: "z",
              n: 1,
              aggs: { "max(area)": { d: "2026-10-01T00:00:00.000Z" } },
            },
          ],
        },
      ],
    });

    expect(answer.rows.map(({ cells }) => [cells.c0, cells.c1])).toEqual([
      ["z", "2026-10-01T00:00:00.000Z"],
      ["true", { text: "{}" }],
    ]);
  });

  it.each([
    [false, ["(none)", 2, "text", [9], [10]]],
    [true, [[10], [9], "text", 2, "(none)"]],
  ])(
    "sorts groups by their value in Mongo's order, descending %s",
    (desc, order) => {
      const values = [[10], "text", null, [9], 2];
      const answer = answerFrom({
        source,
        query: query({
          columns: [{ path: "status" }],
          mode: "groups",
          groupBy: { path: "status" },
          orderBy: { path: "status", fn: null, desc },
        }),
        parts: [
          {
            read: "full",
            boxes: [],
            groups: values.map((value, n) => ({
              key: String(n),
              value,
              n: 1,
              aggs: {},
            })),
          },
        ],
      });

      expect(answer.rows.map(({ cells }) => cells.c0)).toEqual(order);
    },
  );

  it("answers distinct values in their order", () => {
    const answer = answerFrom({
      source,
      query: query({
        mode: "distinct",
        columns: [{ path: "status" }],
        groupBy: { path: "status" },
      }),
      parts: [
        {
          read: "exact",
          boxes: [],
          groups: [
            { key: "b", value: "b", n: 9, aggs: {} },
            { key: "a", value: "A", n: 1, aggs: {} },
          ],
        },
      ],
    });

    expect(answer.rows).toEqual([
      { open: null, cells: { c0: "A" } },
      { open: null, cells: { c0: "b" } },
    ]);
    expect(answer).toMatchObject({ mode: "distinct", count: { groups: 2 } });
  });

  it.each([
    [{ n: 4, capped: false }, 4],
    [{ n: 10000, capped: true }, "10,000+"],
  ])("answers a count %j as one cell", (count, cell) => {
    const answer = answerFrom({
      source,
      query: query({ mode: "count", columns: [{ fn: "count", path: "*" }] }),
      parts: [
        {
          read: "exact",
          groups: null,
          boxes: [{ id: "a.b", rows: [], to: null, end: true, count }],
        },
      ],
    });

    expect(answer).toMatchObject({
      mode: "count",
      rows: [{ open: null, cells: { c0: cell } }],
      columns: [{ label: "count" }],
    });
  });
});

describe("answerFrom with capped counts in several boxes", () => {
  it("says at least the cap, not the sum of the caps", () => {
    const box = (id, count) => ({ id, rows: [], to: null, end: true, count });
    const answer = answerFrom({
      source,
      query: query({ mode: "count", columns: [{ fn: "count", path: "*" }] }),
      parts: [
        {
          read: "exact",
          groups: null,
          boxes: [
            box("a.b", { n: 10000, capped: true }),
            box("c.d", { n: 402, capped: false }),
            box("e.f", { n: 10000, capped: true }),
          ],
        },
      ],
    });

    expect(answer.rows[0].cells.c0).toBe("10,000+");
    expect(answer.count).toEqual({ n: 10000, capped: true });
  });
});

const SKIPPED = {
  open: { kind: "application", code: "g", ref: "r9" },
  id: "FgAAAAdfaWQAawBxbH0D4hmgu1sSAA==",
};

describe("answerFrom with a record too large to search", () => {
  it("says the window skipped it, partial", () => {
    const answer = answerFrom({
      source,
      query: query(),
      parts: [
        {
          read: "windowed",
          groups: null,
          boxes: [
            {
              id: "gas.applications",
              rows: [],
              to: { t: row(3, 9).key.t, i: id(9) },
              end: false,
              count: null,
              partial: true,
              skipped: [SKIPPED],
            },
          ],
        },
      ],
    });

    expect(answer).toMatchObject({
      partial: true,
      window: { to: row(3, 9).key.t, skipped: [SKIPPED] },
    });
  });
});

describe("answerFrom with a skip in one box and a newer end in another", () => {
  const twoBoxes = (otherTo) =>
    answerFrom({
      source,
      query: query(),
      parts: [
        {
          read: "windowed",
          groups: null,
          boxes: [
            {
              id: "a.a",
              rows: [],
              to: { t: row(3, 9).key.t, i: id(9) },
              end: false,
              count: null,
              partial: true,
              skipped: [SKIPPED],
            },
            {
              id: "b.b",
              rows: [],
              to: otherTo,
              end: false,
              count: null,
            },
          ],
        },
      ],
    });

  it("says nothing of the skip until the cut reaches it", () => {
    expect(twoBoxes({ t: row(30, 1).key.t, i: id(1) })).toMatchObject({
      partial: false,
      window: { to: row(30, 1).key.t, skipped: [] },
    });
  });

  it("counts it once the cut is that box's end", () => {
    expect(twoBoxes({ t: row(1, 1).key.t, i: id(1) })).toMatchObject({
      partial: true,
      window: { to: row(3, 9).key.t, skipped: [SKIPPED] },
    });
  });
});

describe("answerFrom with no part", () => {
  it("answers an exact read of nothing", () => {
    expect(answerFrom({ source, query: query(), parts: [] })).toMatchObject({
      read: "exact",
      rows: [],
      count: { n: 0, capped: false },
    });
  });
});

describe("answerFrom with groups cut by LIMIT", () => {
  it("counts every group", () => {
    const groups = Array.from({ length: 5 }, (_, n) => ({
      key: `g${n}`,
      value: `G${n}`,
      n: 1,
      aggs: { "count(*)": 1 },
    }));
    const answer = answerFrom({
      source,
      query: query({
        columns: [{ path: "status" }, { fn: "count", path: "*" }],
        groupBy: { path: "status" },
        limit: 2,
      }),
      parts: [{ read: "full", boxes: [], groups }],
    });

    expect(answer.rows).toHaveLength(2);
    expect(answer.count).toEqual({ n: 0, capped: false, groups: 5 });
  });
});

describe("shownBy", () => {
  it("keeps the rows no older than where each box's shown windows ended", () => {
    const keep = shownBy({
      "a.b": { t: row(4, 0).key.t, i: id(2) },
      "c.d": null,
    });

    expect(keep({ ...row(5, 1), box: "a.b" })).toBe(true);
    expect(keep({ ...row(4, 2), box: "a.b" })).toBe(true);
    expect(keep({ ...row(4, 1), box: "a.b" })).toBe(false);
    expect(keep({ ...row(1, 1), box: "c.d" })).toBe(true);
  });
});

describe("answerFrom with documents", () => {
  const SHAPE = { whole: true, id: true };
  const fetched = (minute, n) => ({
    ...row(minute, n),
    id: `id${n}`,
    at: [n],
    size: 100 * n,
  });
  const exact = (rows, count = { n: rows.length, capped: false }) => [
    {
      read: "exact",
      groups: null,
      boxes: [{ id: "gas.outbox", rows, to: null, end: true, count }],
    },
  ];
  const decoded = (base64) =>
    BSON.deserialize(Buffer.from(base64, "base64"), { promoteValues: false });
  const keysOf = (base64, at = 0) => {
    const buf = Buffer.from(base64, "base64");

    return elementsOf(buf, at).map(({ name }) => name);
  };

  it("keeps what each listed row's document is fetched by", () => {
    const answer = answerFrom({
      source,
      query: query({ documents: SHAPE }),
      parts: exact([fetched(5, 1), fetched(4, 2)]),
    });

    expect(answer.rows.map(({ fetch }) => fetch)).toEqual([
      { box: "gas.outbox", id: "id1", at: [1], size: 100 },
      { box: "gas.outbox", id: "id2", at: [2], size: 200 },
    ]);
  });

  it("keeps nothing to fetch by without documents", () => {
    const answer = answerFrom({
      source,
      query: query(),
      parts: exact([fetched(5, 1)]),
    });

    expect(answer.rows[0]).toEqual({
      open: { kind: "application", code: "g", ref: "r1" },
      cells: { c0: "r1" },
    });
  });

  it("gives a group the document mongod's $group gives it, typed, in its order", () => {
    const answer = answerFrom({
      source,
      query: query({
        documents: SHAPE,
        columns: [
          { path: "status" },
          { fn: "count", path: "*", as: "n" },
          { fn: "sum", path: "x", as: "total" },
          { fn: "max", path: "x", as: "most" },
        ],
        groupBy: { path: "status" },
      }),
      parts: [
        {
          read: "exact",
          boxes: [],
          groups: [
            {
              key: "k",
              value: {
                k: [
                  ["b", 1],
                  ["a", 2],
                  ["1", 3],
                ],
              },
              n: 2,
              aggs: {
                "count(*)": 2,
                "sum(x)": [2147483648, 0, 2147483648, "i", null],
                "max(x)": orderedOf(new Double(2.5)),
              },
            },
          ],
        },
      ],
    });
    const [group] = answer.rows;
    const doc = decoded(group.doc);

    expect(group).toMatchObject({ id: null, context: null, docNote: null });
    expect(keysOf(group.doc)).toEqual(["_id", "n", "total", "most"]);
    expect(
      keysOf(group.doc, elementsOf(Buffer.from(group.doc, "base64"))[0].start),
    ).toEqual(["b", "a", "1"]);
    expect(doc.n).toEqual(new Int32(2));
    expect(doc.total).toEqual(Long.fromString("2147483648"));
    expect(doc.most).toEqual(new Double(2.5));
  });

  it("gives a distinct value { v } and a count { n }, an Int64 past 2^31", () => {
    const distinct = answerFrom({
      source,
      query: query({
        documents: SHAPE,
        mode: "distinct",
        columns: [{ path: "status" }],
        groupBy: { path: "status" },
      }),
      parts: [
        {
          read: "exact",
          boxes: [],
          groups: [{ key: "x", value: "A", n: 1, aggs: {} }],
        },
      ],
    });
    const counted = (n) =>
      answerFrom({
        source,
        query: query({
          documents: SHAPE,
          mode: "count",
          columns: [{ fn: "count", path: "*" }],
        }),
        parts: exact([], { n, capped: false }),
      }).rows[0];

    expect(decoded(distinct.rows[0].doc)).toEqual({ v: "A" });
    expect(decoded(counted(7).doc).n).toEqual(new Int32(7));
    expect(decoded(counted(2 ** 31).doc).n).toEqual(Long.fromNumber(2 ** 31));
    expect(counted(7)).toMatchObject({
      id: null,
      context: null,
      docNote: null,
    });
  });
});

describe("answerFrom within the cells allowance", () => {
  const wide = (minute, n) => ({
    ...row(minute, n),
    cells: { c0: "x".repeat(100) },
  });
  const windowed = (id, rows, to) => ({
    read: "windowed",
    groups: null,
    boxes: [{ id, rows, to, end: false, count: null }],
  });

  it("refuses an exact read whose cells don't fit", () => {
    expect(() =>
      answerFrom({
        source,
        query: query(),
        allowance: cellsAllowanceOf(150),
        parts: [
          {
            read: "exact",
            groups: null,
            boxes: [
              {
                id: "a.b",
                rows: [wide(5, 1), wide(4, 2)],
                to: null,
                end: true,
                count: { n: 2, capped: false },
              },
            ],
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ refusal: "CELLS_TOO_LARGE" }));
  });

  it("ends a windowed read early within it, across parts in the merged order, and goes on from there", () => {
    const answer = answerFrom({
      source,
      query: query(),
      allowance: cellsAllowanceOf(250),
      parts: [
        windowed("a.a", [wide(50, 1), wide(30, 3)], {
          t: row(1, 9).key.t,
          i: id(9),
        }),
        windowed("b.b", [wide(40, 2), wide(20, 4)], {
          t: row(1, 8).key.t,
          i: id(8),
        }),
      ],
    });

    expect(answer.rows.map(({ cells }) => cells.c0.length)).toEqual([100, 100]);
    expect(answer.rows.map(({ open }) => open.ref)).toEqual(["r1", "r2"]);
    expect(answer.partial).toBe(true);
    expect(decodePositions(answer.window.positions)).toEqual({
      "a.a": { t: row(40, 2).key.t, i: "0".repeat(24) },
      "b.b": { t: row(40, 2).key.t, i: id(2) },
    });
  });

  it("holds a page to the text its cells draw, a long value by its start", () => {
    const long = (n) => ({ ...row(n, n), cells: { c0: "x".repeat(5000) } });
    const answer = answerFrom({
      source,
      query: query(),
      allowance: { drawn: 2500, held: Infinity },
      parts: [windowed("a.a", [long(3), long(2), long(1)], row(1, 1).key)],
    });

    expect(answer.rows).toHaveLength(2);
    expect(answer.partial).toBe(true);
  });

  const exact = (id, rows, cutAfter) => ({
    read: "exact",
    groups: null,
    boxes: [
      {
        id,
        rows,
        to: null,
        end: true,
        count: { n: rows.length, capped: false },
      },
    ],
    ...(cutAfter && { cutAfter }),
  });

  it("keeps a download's rows that fit across parts, saying it cut them", () => {
    const answer = answerFrom({
      source,
      query: query(),
      allowance: cellsAllowanceOf(250),
      cut: true,
      parts: [
        exact("a.b", [wide(5, 1), wide(3, 3)]),
        exact("c.d", [wide(4, 2)]),
      ],
    });

    expect(answer.rows.map(({ open }) => open.ref)).toEqual(["r1", "r2"]);
    expect(answer.cutAtBytes).toBe(true);
    expect(answer.oldest).toBe(row(4, 2).key.t);
  });

  it("says a part's cut ended the download, as the engine cut it", () => {
    const answer = answerFrom({
      source,
      query: query(),
      allowance: cellsAllowanceOf(256 * 1024 * 1024),
      cut: true,
      parts: [
        exact("a.b", [wide(5, 1), wide(4, 2)], {
          key: { ...wide(4, 2).key, box: "a.b" },
          order: null,
        }),
      ],
    });

    expect(answer.rows).toHaveLength(2);
    expect(answer.cutAtBytes).toBe(true);
    expect(answer.oldest).toBe(row(4, 2).key.t);
  });

  it("ends a download where a part was cut, so no other part's rows show past it", () => {
    const answer = answerFrom({
      source,
      query: query(),
      allowance: cellsAllowanceOf(256 * 1024 * 1024),
      cut: true,
      parts: [
        exact("a.b", [wide(5, 1), wide(4, 2)], {
          key: { ...wide(4, 2).key, box: "a.b" },
          order: null,
        }),
        exact("c.d", [wide(6, 10), wide(4, 11), wide(3, 12)]),
      ],
    });

    expect(answer.rows.map(({ open }) => open.ref)).toEqual([
      "r10",
      "r1",
      "r2",
    ]);
    expect(answer.cutAtBytes).toBe(true);
    expect(answer.oldest).toBe(row(4, 2).key.t);
  });

  it("cuts a sorted download in the Query's order", () => {
    const sorted = (minute, n, value) => ({ ...wide(minute, n), order: value });
    const answer = answerFrom({
      source,
      query: query({ orderBy: { path: "ref", desc: false } }),
      allowance: cellsAllowanceOf(256 * 1024 * 1024),
      cut: true,
      parts: [
        exact("a.b", [sorted(1, 1, "a"), sorted(9, 2, "c")], {
          key: { ...wide(9, 2).key, box: "a.b" },
          order: "c",
        }),
        exact("c.d", [sorted(5, 3, "b"), sorted(2, 4, "d")]),
      ],
    });

    expect(answer.rows.map(({ open }) => open.ref)).toEqual(["r1", "r3", "r2"]);
    expect(answer.cutAtBytes).toBe(true);
  });

  it("says nothing was cut when a part's cut falls past the rows shown", () => {
    const answer = answerFrom({
      source,
      query: query({ limit: 2 }),
      allowance: cellsAllowanceOf(256 * 1024 * 1024),
      cut: true,
      parts: [
        exact("a.b", [wide(5, 1)], {
          key: { ...wide(5, 1).key, box: "a.b" },
          order: null,
        }),
        exact("c.d", [wide(7, 2), wide(6, 3)]),
      ],
    });

    expect(answer.rows.map(({ open }) => open.ref)).toEqual(["r2", "r3"]);
    expect(answer.cutAtBytes).toBe(false);
  });
});

describe("limitsOf", () => {
  it("gives the rows an answer holds for its columns, and how to raise them", () => {
    expect(
      limitsOf(query({ columns: Array(10).fill({ path: "a" }) }), "limit"),
    ).toEqual({ rows: 2000, raise: "limit" });
    expect(limitsOf(query(), null)).toEqual({ rows: 5000, raise: null });
  });
});
