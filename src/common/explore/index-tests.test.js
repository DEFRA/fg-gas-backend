import { describe, expect, it } from "vitest";
import { classifyTests, usablePaths } from "./index-tests.js";

const paths = new Map(
  [
    { path: "clientRef", index: "ref", closed: false, within: null },
    { path: "identifiers.sbi", index: "ref", closed: false, within: null },
    { path: "refs", index: "refs", closed: false, within: null },
    { path: "code", index: "fact", closed: false, within: null },
    {
      path: "currentConfigVersion",
      index: "fact",
      closed: false,
      within: "code",
    },
    { path: "status", index: "fact", closed: true, within: null },
    { path: "createdAt", index: "time", closed: false, within: null },
    { path: "service", index: "box", closed: true, within: null },
    { path: "currentStatus", index: null, closed: false, within: null },
  ].map((entry) => [entry.path, entry]),
);

const pathOf = (path) => paths.get(path) ?? null;

const test = (path, op, ...values) => ({ path, op, values });

const date = (text) => ({ date: text });

const whys = (...conditions) =>
  classifyTests(conditions, pathOf).tests.map(({ why }) => why);

const read = (condition) => classifyTests([condition], pathOf).tests[0];

describe("classifyTests", () => {
  it("reads a list of refs, and an OR of one path or of refs, through the index, as one $in", () => {
    const refs = Array.from({ length: 50 }, (_, n) => `r${n}`);

    expect(read(test("clientRef", "in", ...refs)).why).toBeNull();
    expect(
      read({ any: [test("code", "eq", "a"), test("code", "in", "b", "c")] }),
    ).toMatchObject({
      why: null,
      test: { path: "code", op: "in", values: ["a", "b", "c"] },
    });
  });

  it("keeps an OR of refs' own tests, for the exact read to recheck", () => {
    const branches = [
      test("clientRef", "eq", "R"),
      test("identifiers.sbi", "eq", "1"),
      test("refs", "eq", "agreement:a1"),
    ];

    expect(read({ any: branches })).toMatchObject({
      why: null,
      test: {
        path: "clientRef",
        op: "in",
        values: ["R", "1", "agreement:a1"],
        paths: ["clientRef", "identifiers.sbi", "refs"],
        branches,
      },
    });
  });

  it("counts a ref's scans by its bucket's lead", () => {
    const led = (path) =>
      path === "clientRef" ? { ...pathOf(path), scans: 17 } : pathOf(path);

    expect(
      classifyTests([test("clientRef", "in", "a", "b", "c")], led).tests[0].why,
    ).toBe("TOO_MANY_COMBINATIONS");
    expect(
      classifyTests([test("clientRef", "in", "a", "b")], led).tests[0].why,
    ).toBeNull();
  });

  it("reads index tests through the index", () => {
    expect(
      whys(
        test("code", "in", "a", "b"),
        test("currentConfigVersion", "eq", "1"),
        test("status", "ne", "x"),
        test("clientRef", "eq", "r"),
        test("createdAt", "gte", date("2026-10-01")),
        test("createdAt", "lt", "2026-11-01T00:00:00.000Z"),
        test("service", "eq", "GAS"),
      ),
    ).toEqual([null, null, null, null, null, null, null]);
  });

  it("reads refs itself, and a value no ref can be, through the index", () => {
    expect(whys(test("refs", "in", "sbi:1", "ref:a"))).toEqual([null]);
    expect(whys(test("identifiers.sbi", "eq", 200000001))).toEqual([null]);
  });

  it.each([
    [
      "an OR of a fact and a ref",
      [{ any: [test("code", "eq", "a"), test("clientRef", "eq", "r")] }],
      "NESTED",
    ],
    [
      "an OR of two facts",
      [{ any: [test("code", "eq", "a"), test("status", "eq", "x")] }],
      "NESTED",
    ],
    [
      "an OR with a test the index can't take",
      [
        {
          any: [test("clientRef", "eq", "r"), test("currentStatus", "eq", "b")],
        },
      ],
      "NESTED",
    ],
    [
      "an OR with a blank ref",
      [{ any: [test("clientRef", "eq", "r"), test("clientRef", "eq", "")] }],
      "NESTED",
    ],
    [
      "a list of refs past the scans",
      [
        test(
          "clientRef",
          "in",
          ...Array.from({ length: 51 }, (_, n) => `r${n}`),
        ),
      ],
      "TOO_MANY_COMBINATIONS",
    ],
    ["a path with no index", [test("currentStatus", "eq", "a")], "NOT_INDEXED"],
    ["a path the source doesn't know", [test("a.b", "eq", "a")], "NOT_INDEXED"],
    ["$ne on an open fact", [test("code", "ne", "a")], "NOT_INDEX_OPERATOR"],
    ["null on a fact", [test("code", "in", null, "a")], "NOT_INDEX_OPERATOR"],
    ["null on a ref", [test("clientRef", "eq", null)], "NOT_INDEX_OPERATOR"],
    ["a blank ref", [test("clientRef", "eq", "")], "NOT_INDEX_OPERATOR"],
    ["a blank in refs", [test("refs", "in", "a", "")], "NOT_INDEX_OPERATOR"],
    [
      "a pattern on a ref",
      [test("clientRef", "regex", { pattern: "a", flags: "" })],
      "NOT_INDEX_OPERATOR",
    ],
    [
      "a time that isn't a date",
      [test("createdAt", "eq", "2026-02-30")],
      "NOT_INDEX_OPERATOR",
    ],
    [
      "a time equal to typed text, which stays text",
      [test("createdAt", "eq", "2026-11-01")],
      "NOT_INDEX_OPERATOR",
    ],
    [
      "a time compared with a number",
      [test("createdAt", "gt", 4)],
      "NOT_INDEX_OPERATOR",
    ],
    [
      "a version without its grant",
      [test("currentConfigVersion", "eq", "1")],
      "WITHOUT_PARTNER",
    ],
  ])("tests %s record by record", (_, conditions, why) => {
    expect(whys(...conditions)).toEqual([why]);
  });

  it("keeps an $or of a version without its grant as it was asked", () => {
    const asked = { any: [test("currentConfigVersion", "eq", "1")] };
    const { why, test: kept } = read(asked);

    expect(why).toBe("WITHOUT_PARTNER");
    expect(kept).toBe(asked);
  });

  it("reads one ref through the index, a second record by record", () => {
    expect(
      whys(test("clientRef", "eq", "a"), test("refs", "eq", "sbi:b")),
    ).toEqual([null, "SECOND_REF"]);
  });

  it("reads a fact once through the index", () => {
    expect(whys(test("code", "eq", "a"), test("code", "eq", "b"))).toEqual([
      null,
      "REPEATED",
    ]);
  });

  it("stops at too many combinations of values", () => {
    const many = (n) => Array.from({ length: n }, (_, i) => `v${i}`);

    expect(
      whys(
        test("code", "in", ...many(8)),
        test("currentConfigVersion", "in", ...many(7)),
      ),
    ).toEqual([null, "TOO_MANY_COMBINATIONS"]);
  });
});

describe("usablePaths", () => {
  it("lists only what would work: one ref once a ref is read, a path within another beside it", () => {
    const { taken } = classifyTests([test("clientRef", "eq", "a")], pathOf);

    expect(usablePaths([...paths.values()], taken)).toEqual([
      "clientRef",
      "code",
      "currentConfigVersion with code",
      "status",
      "createdAt",
      "service",
    ]);
  });
});
