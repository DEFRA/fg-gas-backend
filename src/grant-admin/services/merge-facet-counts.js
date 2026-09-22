import { sumCounts } from "../../events/status-counts.js";

// `counts` is the STATUS facet: it honours every other filter the operator
// has set and refuses `status` itself. No `total` travels beside it - a
// number derived from the numbers beside it in the same object is a second
// chance to disagree with them, so the caller does the addition. A source that
// failed contributes zeros and names itself in `sourceErrors`, so the numbers
// stay renderable and visibly incomplete.
export const mergeFacetCounts = (results) => ({
  counts: sumCounts(results.map((result) => result.counts)),
});
