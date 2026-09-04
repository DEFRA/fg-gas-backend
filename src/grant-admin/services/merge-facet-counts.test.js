import { describe, expect, it } from "vitest";
import { zeroCounts } from "../../common/status-counts.js";
import { mergeFacetCounts } from "./merge-facet-counts.js";

const counts = (overrides) => ({ ...zeroCounts(), ...overrides });

const facets = (statusCounts) => ({ counts: statusCounts });

// The sources the use case hands over, already narrowed to the ones the
// `service` filter selects - the merge does no selecting of its own now.
const gasBoxes = () => [
  facets(counts({ FAILED: 2, COMPLETED: 1 })),
  facets(counts({ FAILED: 1, PARKED: 4 })),
];

const fourSources = () => [
  ...gasBoxes(),
  facets(counts({ DEAD_LETTER: 6 })),
  facets(counts({ COMPLETED: 7 })),
];

describe("mergeFacetCounts", () => {
  it("sums every source into the status counts", () => {
    expect(mergeFacetCounts(fourSources()).counts).toEqual(
      counts({ FAILED: 3, COMPLETED: 8, PARKED: 4, DEAD_LETTER: 6 }),
    );
  });

  // The caller narrows before it merges, so a page filtered to one service
  // hands over only that service's boxes and the sum is of those alone.
  it("counts only the sources it is handed", () => {
    const merged = mergeFacetCounts(gasBoxes());

    expect(merged.counts).toEqual(
      counts({ FAILED: 3, COMPLETED: 1, PARKED: 4 }),
    );
  });

  // One block, and nothing derived from it. `total` was the seven numbers in
  // `counts` added up and sent beside them, which is a figure that can only
  // ever agree with them or be a bug; the caller adds them up instead. The two
  // service-shaped blocks went before it.
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

  it("always answers with every status, PARKED included", () => {
    expect(Object.keys(mergeFacetCounts([]).counts)).toEqual(
      Object.keys(zeroCounts()),
    );
  });
});
