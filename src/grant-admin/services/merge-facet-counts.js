import { sumCounts } from "../../common/status-counts.js";

// Merges the sources' per-source facets into the one block the events filter
// bar renders numbers from.
//
// FACETED, not filtered - and there is only one facet left. `counts` is the
// STATUS segment: it honours every other filter the operator has set,
// `service` included, and refuses `status` itself, which is what makes it a
// facet rather than a count of the page.
//
// It used to answer with a `total` beside it, which was `counts` added up. A
// number derived from seven numbers in the same object is not a second fact,
// it is a second chance to disagree with the first, so the caller does the
// addition.
//
// The SERVICE segments carry no numbers, so nothing here divides by service.
// That is also why the results handed in are already only the selected
// sources': with no byService block to answer for the service the operator did
// NOT pick, there is nothing left to read the other one for - see
// use-cases/count-events.use-case.js.
//
// A source that failed contributes zeros and names itself in `sourceErrors`,
// so the numbers stay renderable and visibly incomplete - the same partial
// answer the list gives.

// `results` are the per-source facet blocks, one per source that answered.
export const mergeFacetCounts = (results) => ({
  counts: sumCounts(results.map((result) => result.counts)),
});
