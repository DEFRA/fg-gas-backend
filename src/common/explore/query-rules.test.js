import { describe, expect, it } from "vitest";
import { keepsRules, refusedPathsOf } from "./query-rules.js";

const source = {
  name: "cases",
  service: "CW",
  boxes: [{ id: "cw.cases" }],
};

const query = (overrides = {}) => ({
  v: 2,
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
  ])("refuses %s", (_, asked) => {
    expect(keepsRules(source, asked)).toBe(false);
  });
});

describe("refusedPathsOf", () => {
  const lists = { roots: ["caseRef", "currentStatus", "payload"] };

  it("counts no path a source may read", () => {
    expect(
      refusedPathsOf(
        query({
          where: {
            path: "payload.answers.applicant.business.name",
            op: "regex",
            values: [{ pattern: "x", flags: "" }],
          },
          columns: [{ path: "caseRef" }, { fn: "count", path: "*" }],
          orderBy: { path: "currentStatus", fn: null, desc: false },
        }),
        lists,
      ),
    ).toBe(0);
  });

  it("counts a path read in several places once", () => {
    expect(
      refusedPathsOf(
        query({
          mode: "distinct",
          columns: [{ path: "comments" }],
          groupBy: { path: "comments" },
          where: { path: "comments", op: "filled", values: [] },
        }),
        lists,
      ),
    ).toBe(1);
  });

  it("counts each path off its roots, or denied, wherever it is", () => {
    expect(
      refusedPathsOf(
        query({
          where: {
            not: { path: "comments.text", op: "eq", values: ["x"] },
          },
          columns: [
            { path: "payload.bank" },
            { path: "payload.answers.sortCode" },
          ],
          groupBy: null,
          orderBy: { path: "timeline", fn: null, desc: true },
        }),
        lists,
      ),
    ).toBe(4);
  });
});
