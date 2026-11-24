import { describe, expect, it } from "vitest";
import { keepsRules, refusedPathsOf } from "./query-rules.js";

const source = {
  name: "cases",
  service: "CW",
  boxes: [{ id: "cw.cases" }],
};

const query = (overrides = {}) => ({
  v: 3,
  source: "cases",
  mode: "rows",
  columns: [{ path: "caseRef" }],
  where: null,
  groupBy: null,
  orderBy: null,
  limit: 50,
  positions: null,
  ...overrides,
});

describe("keepsRules", () => {
  it.each([
    ["rows", query()],
    [
      "groups of a path, worked out",
      query({
        mode: "groups",
        columns: [
          { path: "currentStatus" },
          { fn: "count", path: "*" },
          { fn: "sum", path: "caseRef", as: "total" },
          { fn: "max", path: "createdAt" },
        ],
        groupBy: { path: "currentStatus" },
      }),
    ],
    ["its own box's position", query({ positions: { "cw.cases": null } })],
    ["20,000 cells", query({ columns: [{ path: "caseRef" }], limit: 5000 })],
    [
      "a filter, sort and group on a $ key",
      query({
        mode: "groups",
        columns: [{ path: "a.$ref" }, { fn: "count", path: "*" }],
        where: { path: "a.$ref", op: "filled", values: [] },
        groupBy: { path: "a.$ref" },
        orderBy: { path: "a.$ref", fn: null, desc: false },
        unwind: [],
      }),
    ],
    [
      "distinct values of a $ key",
      query({
        mode: "distinct",
        columns: [{ path: "a.$ref" }],
        groupBy: { path: "a.$ref" },
      }),
    ],
  ])("keeps %s", (_, asked) => {
    expect(keepsRules(source, asked)).toBe(true);
  });

  it.each([
    [
      "count(*) in a row",
      query({ columns: [{ path: "caseRef" }, { fn: "count", path: "*" }] }),
    ],
    [
      "rows sorted by count(*)",
      query({ orderBy: { fn: "count", path: "*", desc: true } }),
    ],
    [
      "more than 20,000 cells",
      query({
        columns: Array.from({ length: 5 }, () => ({ path: "caseRef" })),
        limit: 5000,
      }),
    ],
    [
      "a group showing another path",
      query({
        mode: "groups",
        columns: [{ path: "caseRef" }, { fn: "count", path: "*" }],
        groupBy: { path: "currentStatus" },
      }),
    ],
    [
      "distinct values of another path",
      query({
        mode: "distinct",
        columns: [{ path: "caseRef" }],
        groupBy: { path: "currentStatus" },
      }),
    ],
    [
      "another service's box",
      query({ positions: { "gas.outbox": null, "cw.cases": null } }),
    ],
    ["a column of a $ key", query({ columns: [{ path: "a.$ref" }] })],
    [
      "a column worked out of a $ key",
      query({ columns: [{ fn: "count", path: "a.$ref", as: "n" }] }),
    ],
    [
      "an aggregate of a $ key",
      query({
        mode: "groups",
        columns: [{ path: "status" }, { fn: "max", path: "a.$ref" }],
        groupBy: { path: "status" },
      }),
    ],
    [
      "an unwind of a $ key",
      query({ unwind: [{ path: "a.$defs", preserve: false }] }),
    ],
  ])("refuses %s", (_, asked) => {
    expect(keepsRules(source, asked)).toBe(false);
  });
});

describe("refusedPathsOf", () => {
  it("counts no path a source may read: every well-formed one", () => {
    expect(
      refusedPathsOf(
        query({
          where: {
            all: [
              { path: "comments.text", op: "eq", values: ["x"] },
              { path: "_id", op: "eq", values: [{ oid: "0".repeat(24) }] },
            ],
          },
          columns: [{ path: "payload.bank" }, { fn: "count", path: "*" }],
          orderBy: { path: "timeline", fn: null, desc: false },
        }),
      ),
    ).toBe(0);
  });

  it("counts each malformed path once, wherever it is", () => {
    expect(
      refusedPathsOf(
        query({
          mode: "distinct",
          columns: [{ path: "$where" }],
          groupBy: { path: "$where" },
          where: {
            all: [
              { path: "$where", op: "filled", values: [] },
              { path: "a..b", op: "filled", values: [] },
            ],
          },
        }),
      ),
    ).toBe(2);
  });
});
