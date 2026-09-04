import { describe, expect, it } from "vitest";
import { toSourceFacets, zeroFacets } from "./event-facets.js";
import { zeroCounts } from "./status-counts.js";

const row = (status, count) => ({ _id: status, count });

describe("toSourceFacets", () => {
  it("counts the $group rows into the status block", () => {
    expect(
      toSourceFacets([row("FAILED", 5), row("COMPLETED", 1)]).counts,
    ).toEqual({
      ...zeroCounts(),
      FAILED: 5,
      COMPLETED: 1,
    });
  });

  it("ignores a rogue document's status rather than widening the shape", () => {
    const { counts } = toSourceFacets([row("NONSENSE", 4), row("FAILED", 1)]);

    expect(Object.keys(counts)).toEqual(Object.keys(zeroCounts()));
    expect(counts.FAILED).toBe(1);
  });

  it("answers zeros in every block for an empty box", () => {
    expect(toSourceFacets([])).toEqual(zeroFacets());
    expect(toSourceFacets(undefined)).toEqual(zeroFacets());
  });
});

describe("zeroFacets", () => {
  it("is zeros in every block", () => {
    expect(zeroFacets()).toEqual({ counts: zeroCounts() });
  });
});
