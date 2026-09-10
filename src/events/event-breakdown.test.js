import { describe, expect, it } from "vitest";
import { EVENT_TYPE_FIELDS } from "./event-audit.js";
import {
  BREAKDOWN_GROUP_LIMIT,
  BREAKDOWN_SOURCE_LIMIT,
  breakdownStages,
  toBreakdownGroup,
  toBreakdownGroups,
} from "./event-breakdown.js";

const stages = (overrides = {}) =>
  breakdownStages({
    filter: { status: "DEAD_LETTER" },
    typeField: "type",
    sortKey: "eventTime",
    ...overrides,
  });

describe("breakdownStages", () => {
  it("matches on the filter it is given, and nothing else", () => {
    expect(stages()[0]).toEqual({ $match: { status: "DEAD_LETTER" } });
  });

  it("groups on the stored error message and the box's own type field", () => {
    expect(stages()[1].$group._id).toEqual({
      error: { $ifNull: ["$lastError.message", null] },
      type: { $ifNull: ["$type", null] },
      audit: { $literal: false },
    });
  });

  // An audit record and a type-less anomaly both group under a null type and
  // are not the same thing, so where the row was addressed goes into the key.
  it("puts the caller's audit expression into the key", () => {
    const [, group] = stages({
      auditExpression: { $eq: ["$target", "arn:audit"] },
    });

    expect(group.$group._id.audit).toEqual({ $eq: ["$target", "arn:audit"] });
  });

  // The inbox has no destination field at all, so it never asks the question.
  // `$literal` because `$group` reads a bare boolean as an inclusion-style
  // projection and refuses the whole pipeline.
  it("defaults the audit flag to a literal false", () => {
    expect(stages()[1].$group._id.audit).toEqual({ $literal: false });
  });

  it("uses the outbox's nested type field when told to", () => {
    const [, group] = stages({ typeField: EVENT_TYPE_FIELDS.outbox });

    expect(group.$group._id.type).toEqual({
      $ifNull: ["$event.type", null],
    });
  });

  it("takes first-seen and last-seen off the box's own sort key", () => {
    const [, group] = stages({ sortKey: "publicationDate" });

    expect(group.$group.firstAt).toEqual({ $min: "$publicationDate" });
    expect(group.$group.lastAt).toEqual({ $max: "$publicationDate" });
  });

  it("counts one per document", () => {
    expect(stages()[1].$group.count).toEqual({ $sum: 1 });
  });

  it("sorts commonest first and caps what one source can contribute", () => {
    expect(stages()[2]).toEqual({ $sort: { count: -1 } });
    expect(stages()[3]).toEqual({ $limit: BREAKDOWN_SOURCE_LIMIT });
  });

  it("lets one source contribute more than the merged answer shows, so a group that is large overall is not lost", () => {
    expect(BREAKDOWN_SOURCE_LIMIT).toBeGreaterThan(BREAKDOWN_GROUP_LIMIT);
  });
});

describe("toBreakdownGroup", () => {
  const aRow = (overrides = {}) => ({
    _id: { error: "boom", type: "cloud.defra.prd.svc.case.create" },
    count: 3,
    firstAt: "2026-06-16T10:00:00.000Z",
    lastAt: "2026-06-16T11:00:00.000Z",
    ...overrides,
  });

  it("flattens the grouped key onto the wire shape", () => {
    expect(toBreakdownGroup(aRow())).toEqual({
      error: "boom",
      type: "cloud.defra.prd.svc.case.create",
      audit: false,
      count: 3,
      firstAt: "2026-06-16T10:00:00.000Z",
      lastAt: "2026-06-16T11:00:00.000Z",
    });
  });

  // Carried through for the merge layer, which turns it into the label. A
  // source that cannot answer the question omits it, and that reads as false.
  it("carries the grouped audit flag, defaulting it to false", () => {
    expect(
      toBreakdownGroup(aRow({ _id: { error: "boom", audit: true } })).audit,
    ).toBe(true);
    expect(toBreakdownGroup(aRow()).audit).toBe(false);
  });

  it("keeps the raw type - shortening for display is the merge layer's job", () => {
    expect(toBreakdownGroup(aRow()).type).toBe(
      "cloud.defra.prd.svc.case.create",
    );
  });

  it("keeps a null error as its own group rather than dropping it", () => {
    expect(
      toBreakdownGroup(aRow({ _id: { error: null, type: "t" } })).error,
    ).toBeNull();
  });

  it("normalises Date timestamps to ISO strings", () => {
    const group = toBreakdownGroup(
      aRow({ firstAt: new Date("2026-06-16T10:00:00.000Z") }),
    );

    expect(group.firstAt).toBe("2026-06-16T10:00:00.000Z");
  });

  it("answers null for a timestamp that is absent or unparseable", () => {
    expect(toBreakdownGroup(aRow({ firstAt: null })).firstAt).toBeNull();
    expect(toBreakdownGroup(aRow({ lastAt: "not a date" })).lastAt).toBeNull();
  });

  it("survives a row with no grouped key at all", () => {
    expect(toBreakdownGroup({ count: 1 })).toEqual({
      error: null,
      type: null,
      audit: false,
      count: 1,
      firstAt: null,
      lastAt: null,
    });
  });
});

describe("toBreakdownGroups", () => {
  it("maps every row", () => {
    expect(
      toBreakdownGroups([
        { _id: { error: "a", type: "t" }, count: 2 },
        { _id: { error: "b", type: "t" }, count: 1 },
      ]),
    ).toHaveLength(2);
  });

  it("treats no rows as no groups", () => {
    expect(toBreakdownGroups(undefined)).toEqual([]);
    expect(toBreakdownGroups([])).toEqual([]);
  });
});
