import { describe, expect, it } from "vitest";
import {
  isWithinLimits,
  partSchema,
  querySchema,
  sourcesSchema,
} from "./query-schema.js";

const query = (overrides = {}) => ({
  v: 3,
  source: "cases",
  mode: "rows",
  columns: [
    { path: "caseRef" },
    { fn: "count", path: "payload.answers.parcels.parcelId", as: "parcels" },
  ],
  where: {
    all: [
      { path: "workflowCode", op: "eq", values: ["frps-private-beta"] },
      {
        not: {
          path: "payload.answers.applicant.business.name",
          op: "regex",
          values: [{ pattern: "hill", flags: "i" }],
        },
      },
      { path: "createdAt", op: "gte", values: [{ date: "2026-10-01" }] },
      { path: "closed", op: "in", values: [true, null] },
      { path: "phases.0.code", op: "eq", values: [3] },
    ],
  },
  unwind: [],
  groupBy: null,
  orderBy: { path: "createdAt", fn: null, desc: false },
  limit: 50,
  positions: null,
  ...overrides,
});

const isValid = (value) => !querySchema.validate(value).error;

const test = (overrides) => ({
  path: "currentStatus",
  op: "eq",
  values: ["a"],
  ...overrides,
});

describe("querySchema", () => {
  it("reads a Query", () => {
    expect(isValid(query())).toBe(true);
  });

  it("reads up to 4 unwinds on rows and groups", () => {
    const unwind = Array.from({ length: 4 }, () => ({
      path: "phases",
      preserve: true,
    }));

    expect(isValid(query({ unwind }))).toBe(true);
    expect(
      isValid(
        query({
          mode: "groups",
          unwind,
          columns: [{ path: "phases.code" }],
          groupBy: { path: "phases.code" },
          orderBy: null,
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["version 1, which names fields", { v: 1 }],
    ["version 2", { v: 2 }],
    ["a path named as an operator", { columns: [{ path: "$where" }] }],
    ["a malformed path", { columns: [{ path: "a..b" }] }],
    ["a path starting $", { columns: [{ path: "$schema.x" }] }],
    ["a $ segment alone", { columns: [{ path: "a.$" }] }],
    ["an inherited name", { where: test({ path: "a.__proto__" }) }],
    ["a field name", { columns: [{ field: "ref" }] }],
    ["an answers map", { answers: {} }],
    ["no unwind", { unwind: undefined }],
    [
      "an unwind of a malformed path",
      { unwind: [{ path: "payload..bank", preserve: false }] },
    ],
    ["an unwind without preserve", { unwind: [{ path: "payload" }] }],
    [
      "an unwind kept by text",
      { unwind: [{ path: "payload", preserve: "true" }] },
    ],
    [
      "an unwind with an index",
      {
        unwind: [{ path: "payload", preserve: false, includeArrayIndex: "n" }],
      },
    ],
    [
      "five unwinds",
      {
        unwind: Array.from({ length: 5 }, () => ({
          path: "phases",
          preserve: false,
        })),
      },
    ],
    [
      "an unwind on a count",
      {
        mode: "count",
        columns: [{ fn: "count", path: "*" }],
        unwind: [{ path: "phases", preserve: true }],
      },
    ],
    ["an unknown function", { columns: [{ fn: "avg", path: "x" }] }],
    [
      "too many columns",
      { columns: Array.from({ length: 21 }, () => ({ path: "caseRef" })) },
    ],
    ["an unknown operator", { where: test({ op: "regex" }) }],
    ["an operator as a key", { where: { $where: "1" } }],
    ["a value that is an object", { where: test({ values: [{ $gt: "" }] }) }],
    [
      "a value over 200 characters",
      { where: test({ values: ["x".repeat(201)] }) },
    ],
    ["two values for =", { where: test({ values: ["a", "b"] }) }],
    ["a value for IS EMPTY", { where: test({ op: "empty", values: ["a"] }) }],
    [
      "51 values in a list",
      { where: test({ op: "in", values: Array.from({ length: 51 }, String) }) },
    ],
    ["a limit over 5,000", { limit: 5001 }],
    ["a key it doesn't know", { extra: true }],
    ["a * column that isn't a count", { columns: [{ path: "*" }] }],
    ["a * sum", { columns: [{ fn: "sum", path: "*" }] }],
    ["an empty as", { columns: [{ path: "currentStatus", as: "" }] }],
    [
      "a sort by * that isn't a count",
      { orderBy: { path: "*", fn: null, desc: true } },
    ],
    ["distinct values with no path", { mode: "distinct", groupBy: null }],
    ["groups with no path", { mode: "groups", groupBy: null }],
    ["rows grouped", { mode: "rows", groupBy: { path: "currentStatus" } }],
    [
      "a count with other columns",
      { mode: "count", columns: [{ path: "currentStatus" }] },
    ],
    ["a mode it doesn't know", { mode: "explain" }],
    [
      "a pattern over 64 characters",
      {
        where: {
          path: "x",
          op: "regex",
          values: [{ pattern: "a".repeat(65), flags: "" }],
        },
      },
    ],
    [
      "a pattern flag it doesn't know",
      {
        where: {
          path: "x",
          op: "regex",
          values: [{ pattern: "a", flags: "g" }],
        },
      },
    ],
    [
      "a pattern given as text",
      { where: { path: "x", op: "regex", values: ["a"] } },
    ],
    ["a date that isn't one", { where: test({ values: [{ date: "soon" }] }) }],
    [
      "a date of no real month",
      { where: test({ values: [{ date: "2026-13-01" }] }) },
    ],
    [
      "a date of no real time",
      { where: test({ values: [{ date: "2026-10-01T25:00:00Z" }] }) },
    ],
    ["a position that is no box", { positions: { $where: "x" } }],
    ["version 4", { v: 4 }],
    [
      "an ObjectId of 23 hex",
      { where: test({ values: [{ oid: "a".repeat(23) }] }) },
    ],
    [
      "an ObjectId in upper case",
      { where: test({ values: [{ oid: "A".repeat(24) }] }) },
    ],
    [
      "an ObjectId of what isn't hex",
      { where: test({ values: [{ oid: "g".repeat(24) }] }) },
    ],
    [
      "an error key over 120 code points",
      { where: test({ path: "errorKey", values: ["é".repeat(121)] }) },
    ],
    [
      "an error key over 240 UTF-16 units",
      { where: test({ path: "errorKey", values: ["😀".repeat(121)] }) },
    ],
  ])("refuses %s", (_, overrides) => {
    expect(isValid(query(overrides))).toBe(false);
  });

  it("reads _id, $ keys after the first and ObjectIds in v3", () => {
    const oid = { oid: "6741a0c2e4b0f1a2b3c4d5e6" };

    expect(
      isValid(
        query({
          v: 3,
          columns: [{ path: "_id" }, { path: "a._x" }],
          where: {
            all: [
              test({ path: "_id", op: "in", values: [oid, oid] }),
              test({ path: "_id", op: "gte", values: [oid] }),
              test({
                path: "phases.questions.$schema",
                op: "filled",
                values: [],
              }),
            ],
          },
          orderBy: { path: "_id", fn: null, desc: true },
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        query({
          v: 3,
          mode: "groups",
          columns: [{ path: "_id" }],
          groupBy: { path: "_id" },
          orderBy: null,
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["an _id column", { columns: [{ path: "_id" }] }],
    ["an _id test", { where: test({ path: "_id", op: "filled", values: [] }) }],
    [
      "a $ key in a test",
      { where: test({ path: "a.$schema", op: "filled", values: [] }) },
    ],
    [
      "an ObjectId on another path",
      { where: test({ values: [{ oid: "6741a0c2e4b0f1a2b3c4d5e6" }] }) },
    ],
    ["a sort by _id", { orderBy: { path: "_id", fn: null, desc: true } }],
    [
      "a group by a $ key",
      {
        mode: "groups",
        columns: [{ path: "a.$schema" }],
        groupBy: { path: "a.$schema" },
        orderBy: null,
      },
    ],
    [
      "an unwind of _id",
      { unwind: [{ path: "_id", preserve: false }], orderBy: null },
    ],
  ])("reads %s", (_, overrides) => {
    expect(isValid(query(overrides))).toBe(true);
  });

  it("reads an error key by its code points, up to 120 however long in UTF-16", () => {
    expect(
      isValid(
        query({
          where: test({ path: "errorKey", values: ["😀".repeat(120)] }),
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        query({ where: test({ path: "status", values: ["😀".repeat(120)] }) }),
      ),
    ).toBe(false);
    expect(
      isValid(
        query({ where: test({ path: "errorKey", values: ["x".repeat(200)] }) }),
      ),
    ).toBe(false);
  });

  it("checks the size and depth of a WHERE apart", () => {
    const tests = (n) => ({ all: Array.from({ length: n }, () => test()) });
    const nested = (depth) =>
      Array.from({ length: depth }).reduce((node) => ({ not: node }), test());

    expect(isWithinLimits(query({ where: tests(30) }))).toBe(true);
    expect(isWithinLimits(query({ where: { any: [tests(30), test()] } }))).toBe(
      false,
    );
    expect(isWithinLimits(query({ where: nested(8) }))).toBe(true);
    expect(isWithinLimits(query({ where: nested(9) }))).toBe(false);
  });

  it.each([
    ["(a|b)c", "i", true],
    ["(?=a)", "", false],
    ["a{1,30}", "", false],
    ["((a{20}){20}){20}", "", false],
    ["a[", "", false],
  ])(
    "checks the pattern %s apart, as the matcher takes it",
    (pattern, flags, ok) => {
      const regex = {
        path: "payload.answers.applicant.business.name",
        op: "regex",
        values: [{ pattern, flags }],
      };

      expect(isWithinLimits(query({ where: regex }))).toBe(ok);
    },
  );
});

describe("partSchema", () => {
  it("reads a part with rows per box", () => {
    expect(
      partSchema.validate({
        read: "windowed",
        boxes: [
          {
            id: "cw.outbox",
            rows: [
              {
                key: { t: "2026-10-13T00:00:00.000Z", i: "a".repeat(24) },
                open: { kind: "event", service: "CW", box: "outbox", id: "x" },
                cells: {
                  status: "Dead letter",
                  n: 1,
                  list: ["a", 2],
                  none: null,
                },
                order: null,
              },
            ],
            to: { t: "2026-10-13T00:00:00.000Z", i: "a".repeat(24) },
            end: false,
            count: null,
          },
        ],
        groups: null,
      }).error,
    ).toBeUndefined();
  });

  it.each([
    [{ x: "9007199254740993" }, true],
    [{ x: "9007199254740993e0" }, false],
    [{ x: "0" }, true],
    [{ x: "abc" }, false],
    [{ x: "1e9999" }, false],
    [{ c: true }, true],
  ])("reads a group's value %j: %s", (value, valid) => {
    const { error } = partSchema.validate({
      read: "exact",
      boxes: [],
      groups: [{ key: "k", value, n: 1, aggs: {} }],
    });

    expect(error === undefined).toBe(valid);
  });
});

describe("sourcesSchema", () => {
  const sources = (source = {}) => ({
    sources: [
      {
        name: "cases",
        label: "Cases",
        service: "CW",
        size: "big",
        noun: { one: "case", many: "cases" },
        star: ["caseRef", "payload.identifiers.sbi"],
        time: "createdAt",
        roots: ["caseRef", "payload", "definition.phases"],
        answersAt: "payload.answers",
        paths: [
          {
            path: "createdAt",
            type: "date",
            index: "time",
            closed: false,
            within: null,
            stored: "date",
          },
          {
            path: "payload.identifiers.sbi",
            type: "text",
            index: "ref",
            closed: false,
            within: null,
            scans: 1,
          },
          {
            path: "currentConfigVersion",
            index: "fact",
            closed: false,
            within: "workflowCode",
            values: [{ value: "1.0.0", label: "1.0.0" }],
          },
        ],
        ...source,
      },
    ],
  });

  it("reads a source's known paths, with or without roots", () => {
    expect(sourcesSchema.validate(sources()).error).toBeUndefined();
    expect(
      sourcesSchema.validate(sources({ roots: undefined })).error,
    ).toBeUndefined();
  });

  it("reads an _id path typed objectId and indexed by id", () => {
    const withId = sources({
      paths: [
        {
          path: "_id",
          type: "objectId",
          index: "id",
          closed: false,
          within: null,
        },
      ],
    });

    expect(sourcesSchema.validate(withId).error).toBeUndefined();
  });

  it("ignores the fields an older service still sends", () => {
    const older = {
      listedAt: "payload.answers",
      answerPaths: ["applicant.business.name"],
      requires: null,
    };

    expect(sourcesSchema.validate(sources(older)).error).toBeUndefined();
  });

  it.each([
    ["a path it can't read", { paths: [{ path: "a..b", index: null }] }],
    [
      "an index kind it doesn't know",
      {
        paths: [{ path: "a", index: "hash", closed: false, within: null }],
      },
    ],
    ["a type it doesn't know", { paths: [{ path: "a", type: "blob" }] }],
  ])("refuses %s", (_, source) => {
    expect(sourcesSchema.validate(sources(source)).error).toBeDefined();
  });
});
