import { describe, expect, it } from "vitest";
import { BREAKDOWN_GROUP_LIMIT } from "../../common/event-breakdown.js";
import { mergeBreakdownGroups } from "./merge-breakdown-groups.js";

const aGroup = (overrides = {}) => ({
  error: "boom",
  type: "cloud.defra.prd.fg-gas-backend.case.create",
  count: 1,
  firstAt: "2026-06-16T10:00:00.000Z",
  lastAt: "2026-06-16T11:00:00.000Z",
  ...overrides,
});

describe("mergeBreakdownGroups", () => {
  it("shortens the raw stored type to the same display form the list rows carry", () => {
    const [group] = mergeBreakdownGroups([[aGroup()]]);

    expect(group.type).toBe("case.create");
  });

  // Null, not a placeholder string: the group of rows that carry no stored
  // type at all - audit records - says so, exactly as the list rows do, and
  // the frontend renders the absence.
  it("keeps a group with no stored type as a null type", () => {
    const [group] = mergeBreakdownGroups([[aGroup({ type: null })]]);

    expect(group.type).toBeNull();
  });

  it("merges null-type groups together across sources rather than dropping them", () => {
    const merged = mergeBreakdownGroups([
      [aGroup({ type: null, count: 3 })],
      [aGroup({ type: null, count: 4 })],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ type: null, count: 7 });
  });

  it("sorts a null-type group alongside the typed ones without throwing", () => {
    const merged = mergeBreakdownGroups([
      [aGroup({ type: null, count: 2 })],
      [aGroup({ type: "cloud.defra.prd.fg-gas-backend.a.b", count: 9 })],
    ]);

    expect(merged.map((group) => group.count)).toEqual([9, 2]);
  });

  it("merges the same (error, type) across sources, summing the counts", () => {
    const groups = mergeBreakdownGroups([
      [aGroup({ count: 3 })],
      [aGroup({ count: 4 })],
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(7);
  });

  it("takes the earliest firstAt and the latest lastAt across the merged sources", () => {
    const groups = mergeBreakdownGroups([
      [
        aGroup({
          firstAt: "2026-06-16T10:00:00.000Z",
          lastAt: "2026-06-16T11:00:00.000Z",
        }),
      ],
      [
        aGroup({
          firstAt: "2026-06-16T09:00:00.000Z",
          lastAt: "2026-06-16T12:00:00.000Z",
        }),
      ],
    ]);

    expect(groups[0].firstAt).toBe("2026-06-16T09:00:00.000Z");
    expect(groups[0].lastAt).toBe("2026-06-16T12:00:00.000Z");
  });

  it("copes with a source that has no timestamps at all", () => {
    const groups = mergeBreakdownGroups([
      [aGroup({ firstAt: null, lastAt: null })],
      [aGroup()],
    ]);

    expect(groups[0].firstAt).toBe("2026-06-16T10:00:00.000Z");
    expect(groups[0].lastAt).toBe("2026-06-16T11:00:00.000Z");
  });

  it("merges two boxes that store their type in different fields but shorten to the same thing", () => {
    const groups = mergeBreakdownGroups([
      [
        aGroup({
          type: "cloud.defra.prd.fg-gas-backend.case.create",
          count: 2,
        }),
      ],
      [
        aGroup({
          type: "cloud.defra.local.fg-cw-backend.case.create",
          count: 5,
        }),
      ],
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("case.create");
    expect(groups[0].count).toBe(7);
  });

  it("keeps different errors apart", () => {
    const groups = mergeBreakdownGroups([
      [aGroup({ error: "boom" }), aGroup({ error: "bang" })],
    ]);

    expect(groups).toHaveLength(2);
  });

  it("keeps different types apart", () => {
    const groups = mergeBreakdownGroups([
      [
        aGroup({ type: "cloud.defra.prd.svc.a" }),
        aGroup({ type: "cloud.defra.prd.svc.b" }),
      ],
    ]);

    expect(groups).toHaveLength(2);
  });

  it("keeps a null error apart from the literal string 'null'", () => {
    const groups = mergeBreakdownGroups([
      [aGroup({ error: null }), aGroup({ error: "null" })],
    ]);

    expect(groups).toHaveLength(2);
  });

  it("merges null-error groups with each other, so pre-persistence rows are one group", () => {
    const groups = mergeBreakdownGroups([
      [aGroup({ error: null, count: 2 })],
      [aGroup({ error: null, count: 3 })],
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].error).toBeNull();
    expect(groups[0].count).toBe(5);
  });

  it("sorts commonest first", () => {
    const groups = mergeBreakdownGroups([
      [
        aGroup({ error: "small", count: 1 }),
        aGroup({ error: "big", count: 9 }),
        aGroup({ error: "middling", count: 5 }),
      ],
    ]);

    expect(groups.map((group) => group.error)).toEqual([
      "big",
      "middling",
      "small",
    ]);
  });

  it("breaks ties deterministically, so two runs over the same data read the same way round", () => {
    const source = [
      aGroup({ error: "b", count: 2 }),
      aGroup({ error: "a", count: 2 }),
    ];

    expect(mergeBreakdownGroups([source]).map((g) => g.error)).toEqual(
      mergeBreakdownGroups([[...source].reverse()]).map((g) => g.error),
    );
  });

  it("caps the answer at twenty groups, keeping the commonest", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      aGroup({ error: `error-${index}`, count: index + 1 }),
    );

    const groups = mergeBreakdownGroups([many]);

    expect(groups).toHaveLength(BREAKDOWN_GROUP_LIMIT);
    expect(groups[0].count).toBe(30);
    expect(groups.at(-1).count).toBe(30 - BREAKDOWN_GROUP_LIMIT + 1);
  });

  it("caps AFTER merging, so a group that is small in each source but large overall survives", () => {
    const noise = Array.from({ length: 25 }, (_, index) =>
      aGroup({ error: `noise-${index}`, count: 4 }),
    );

    const groups = mergeBreakdownGroups([
      [...noise, aGroup({ error: "shared", count: 3 })],
      [aGroup({ error: "shared", count: 3 })],
      [aGroup({ error: "shared", count: 3 })],
    ]);

    expect(groups[0]).toMatchObject({ error: "shared", count: 9 });
  });

  it("answers with nothing when no source had anything", () => {
    expect(mergeBreakdownGroups([[], [], []])).toEqual([]);
  });
});
