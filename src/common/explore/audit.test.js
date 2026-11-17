import { describe, expect, it } from "vitest";
import {
  conditionsOf,
  knownWordsOf,
  queryShapeOf,
  shownPath,
} from "./audit.js";
import { valueDigest } from "./digest.js";

const KEY = "k".repeat(32);
const SENTINEL = "Sentinel Farm 4417";

const where = {
  all: [
    {
      path: "payload.answers.applicant.business.name",
      op: "regex",
      values: [{ pattern: SENTINEL, flags: "i" }],
    },
    { not: { path: "currentStatus", op: "in", values: ["A", 1] } },
    { path: "closed", op: "eq", values: [true, null] },
    { path: "createdAt", op: "gte", values: [{ date: "2026-10-01" }] },
    { path: "supplementaryData", op: "filled", values: [] },
  ],
};

const known = knownWordsOf([
  "caseRef",
  "currentStatus",
  "closed",
  "createdAt",
  "supplementaryData",
  "payload.answers.applicant.business.name",
]);

describe("conditionsOf", () => {
  it("records each path and operator, and each value only as a keyed digest of its typed text", () => {
    const conditions = conditionsOf(where, KEY, known);

    expect(conditions).toEqual([
      {
        path: "payload.answers.applicant.business.name",
        op: "regex",
        digests: [
          valueDigest(
            KEY,
            "payload.answers.applicant.business.name:/Sentinel Farm 4417/i",
          ),
        ],
      },
      {
        path: "currentStatus",
        op: "in",
        digests: [
          valueDigest(KEY, 'currentStatus:"A"'),
          valueDigest(KEY, "currentStatus:1"),
        ],
      },
      {
        path: "closed",
        op: "eq",
        digests: [
          valueDigest(KEY, "closed:true"),
          valueDigest(KEY, "closed:null"),
        ],
      },
      {
        path: "createdAt",
        op: "gte",
        digests: [
          valueDigest(KEY, "createdAt:ISODate(2026-10-01T00:00:00.000Z)"),
        ],
      },
      { path: "supplementaryData", op: "filled" },
    ]);
    expect(JSON.stringify(conditions)).not.toContain("Sentinel");
  });

  it("digests text and a number of the same digits apart", () => {
    const [text] = conditionsOf({ path: "a", op: "eq", values: ["1"] }, KEY);
    const [number] = conditionsOf({ path: "a", op: "eq", values: [1] }, KEY);

    expect(text.digests).not.toEqual(number.digests);
  });

  it("shows a path's words only where the source knows them", () => {
    expect(
      conditionsOf(
        { path: "agreements.FPTT1.state", op: "filled", values: [] },
        KEY,
      )[0].path,
    ).toBe("?.?.?");
  });

  it.each([undefined, null, ""])(
    "refuses to write conditions without a key (%j)",
    (key) => {
      expect(() => conditionsOf(where, key, known)).toThrow(
        "Explore audit has no SEARCH_AUDIT_KEY",
      );
    },
  );

  it("shows a key of data made of digits as ?", () => {
    const [condition] = conditionsOf(
      {
        path: "payload.answers.landParcels.200000001",
        op: "filled",
        values: [],
      },
      KEY,
      knownWordsOf(["payload.answers.landParcels"]),
    );

    expect(condition.path).toBe("payload.answers.landParcels.?");
  });
});

describe("shownPath", () => {
  it("shows only the source's own words, any other segment, digits too, as ?", () => {
    expect(shownPath("payload.answers.applicant.business.name", known)).toBe(
      "payload.answers.applicant.business.name",
    );
    expect(shownPath("payload.answers.JaneSmith.0", known)).toBe(
      "payload.answers.?.?",
    );
  });
});

describe("queryShapeOf", () => {
  it("renders the Query as mongosh would write it, every value as ?", () => {
    const shape = queryShapeOf(
      {
        source: "cases",
        mode: "groups",
        columns: [
          { path: "currentStatus" },
          { fn: "count", path: "*", as: "cases" },
        ],
        where,
        unwind: [],
        groupBy: { path: "currentStatus" },
        orderBy: { path: "*", fn: "count", desc: true },
        limit: 50,
      },
      known,
    );

    expect(shape).toBe(
      "db.cases.aggregate([{ $match: { $and: [{ 'payload.answers.applicant.business.name': /?/ }, { $nor: [{ currentStatus: { $in: [?, ?] } }] }, { closed: ? }, { createdAt: { $gte: ? } }, { supplementaryData: { $exists: true } }] } }, { $group: { _id: '$currentStatus', '?': { $sum: 1 } } }]).sort({ '?': -1 }).limit(?)",
    );
    expect(shape).not.toContain("Sentinel");
  });

  it("shows a typed name the source's words don't hold, and a path's unknown words, as ?", () => {
    const shape = queryShapeOf(
      {
        source: "cases",
        mode: "rows",
        columns: [
          { path: "caseRef", as: "Jane Smith's ref" },
          { path: "workflowCode", as: "HilltopFarmLtd" },
          { path: "currentStage", as: "$JaneSmith" },
          { path: "currentStatus", as: "currentStatus" },
          { path: "payload.answers.JaneSmith" },
          { fn: "count", path: "phases.stages", as: "stages" },
          { fn: "sum", path: "payload.answers.x", as: "total area" },
        ],
        where: { path: "agreements.FPTT1.state", op: "filled", values: [] },
        unwind: [],
        groupBy: null,
        orderBy: { path: "payload.answers.x", fn: "sum", desc: false },
        limit: 5,
      },
      known,
    );

    expect(shape).toBe(
      "db.cases.find({ '?.?.?': { $exists: true } }, { '?': '$caseRef', '?': '$?', '?': '$?', currentStatus: '$currentStatus', 'payload.answers.?': 1, '?': { $size: '$?.?' }, '?': { $sum: '$payload.answers.?' } }).sort({ '?': 1 }).limit(?)",
    );
    expect(shape).not.toContain("Hilltop");
    expect(shape).not.toContain("Jane");
    expect(shape).not.toContain("FPTT1");
  });

  it.each([
    [
      { mode: "count", columns: [], groupBy: null },
      "db.cases.countDocuments({})",
    ],
    [
      { mode: "distinct", columns: [], groupBy: { path: "currentStatus" } },
      "db.cases.distinct('currentStatus', {})",
    ],
    [
      { mode: "rows", columns: [{ path: "caseRef" }], groupBy: null },
      "db.cases.find({}, { caseRef: 1 }).limit(?)",
    ],
    [
      {
        mode: "rows",
        unwind: [{ path: "payload.answers.JaneSmith", preserve: true }],
        columns: [{ path: "caseRef" }],
        groupBy: null,
        orderBy: { path: "caseRef", fn: null, desc: true },
      },
      "db.cases.aggregate([{ $match: {} }, { $unwind: { path: '$payload.answers.?', preserveNullAndEmptyArrays: true } }, { $project: { caseRef: 1 } }, { $sort: { caseRef: -1 } }, { $limit: ? }])",
    ],
    [
      {
        mode: "groups",
        unwind: [{ path: "phases", preserve: false }],
        columns: [
          { path: "phases.stages" },
          { fn: "count", path: "*", as: "n" },
        ],
        groupBy: { path: "phases.stages" },
      },
      "db.cases.aggregate([{ $match: {} }, { $unwind: { path: '$?', preserveNullAndEmptyArrays: false } }, { $group: { _id: '$?.?', '?': { $sum: 1 } } }]).limit(?)",
    ],
  ])("renders %j", (query, shape) => {
    expect(
      queryShapeOf(
        {
          source: "cases",
          where: null,
          unwind: [],
          orderBy: null,
          limit: 5,
          ...query,
        },
        known,
      ),
    ).toBe(shape);
  });
});
