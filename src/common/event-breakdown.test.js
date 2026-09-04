import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_GROUP_LIMIT,
  BREAKDOWN_SOURCE_LIMIT,
  BREAKDOWN_TYPE_FIELDS,
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
    });
  });

  it("uses the outbox's nested type field when told to", () => {
    const [, group] = stages({ typeField: BREAKDOWN_TYPE_FIELDS.outbox });

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
      count: 3,
      firstAt: "2026-06-16T10:00:00.000Z",
      lastAt: "2026-06-16T11:00:00.000Z",
    });
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
