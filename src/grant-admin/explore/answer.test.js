import { describe, expect, it } from "vitest";
import { decodePositions } from "../../common/explore/merge.js";
import { answerFrom, columnsOf, shownBy, unseenPaths } from "./answer.js";

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
      { key: "c0", label: "clientRef", kind: "text", aggregate: false },
      { key: "c1", label: "parcels", kind: "number", aggregate: true },
      { key: "c2", label: "created", kind: "date", aggregate: false },
      { key: "c3", label: "identifiers.sbi", kind: "text", aggregate: false },
      { key: "c4", label: "missing", kind: "text", aggregate: false },
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
    ).toEqual([{ key: "c0", label: "count", kind: "text", aggregate: true }]);
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
      columns: [{ key: "c0", label: "ref", kind: "text", aggregate: false }],
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
      skipped: 0,
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
            { key: "a", value: "A", n: 1, aggs: { "sum(area)": [9, 0] } },
            { key: "b", value: "B", n: 5, aggs: { "sum(area)": [1, 0] } },
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
              skipped: 1,
            },
          ],
        },
      ],
    });

    expect(answer).toMatchObject({
      partial: true,
      window: { to: row(3, 9).key.t, skipped: 1 },
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
              skipped: 1,
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
      window: { to: row(30, 1).key.t, skipped: 0 },
    });
  });

  it("counts it once the cut is that box's end", () => {
    expect(twoBoxes({ t: row(1, 1).key.t, i: id(1) })).toMatchObject({
      partial: true,
      window: { to: row(3, 9).key.t, skipped: 1 },
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
