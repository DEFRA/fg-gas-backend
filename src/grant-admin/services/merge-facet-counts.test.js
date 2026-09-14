import { describe, expect, it } from "vitest";
import { zeroCounts } from "../../events/status-counts.js";
import { mergeFacetCounts } from "./merge-facet-counts.js";

const counts = (overrides) => ({ ...zeroCounts(), ...overrides });

const facets = (statusCounts) => ({ counts: statusCounts });

// Already narrowed to the sources the `service` filter selects - the merge
// does no selecting of its own.
const gasBoxes = () => [
  facets(counts({ FAILED: 2, COMPLETED: 1 })),
  facets(counts({ FAILED: 1, RESUBMITTED: 4 })),
];

const fourSources = () => [
  ...gasBoxes(),
  facets(counts({ DEAD_LETTER: 6 })),
  facets(counts({ COMPLETED: 7 })),
];

describe("mergeFacetCounts", () => {
  it("sums every source into the status counts", () => {
    expect(mergeFacetCounts(fourSources()).counts).toEqual(
      counts({ FAILED: 3, COMPLETED: 8, RESUBMITTED: 4, DEAD_LETTER: 6 }),
    );
  });

  it("counts only the sources it is handed", () => {
    const merged = mergeFacetCounts(gasBoxes());

    expect(merged.counts).toEqual(
      counts({ FAILED: 3, COMPLETED: 1, RESUBMITTED: 4 }),
    );
  });

  it("answers with the counts block alone", () => {
    const merged = mergeFacetCounts(fourSources());

    expect(Object.keys(merged)).toEqual(["counts"]);
    expect(merged).not.toHaveProperty("total");
    expect(merged).not.toHaveProperty("byService");
    expect(merged).not.toHaveProperty("byKind");
  });

  it("answers zeros with no sources at all", () => {
    expect(mergeFacetCounts([])).toEqual({ counts: zeroCounts() });
  });

  it("always answers with every status", () => {
    expect(Object.keys(mergeFacetCounts([]).counts)).toEqual(
      Object.keys(zeroCounts()),
    );
  });
});
