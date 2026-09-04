import { toStatusCounts, zeroCounts } from "./status-counts.js";

// One source's answer to the FACETED counts question, and the arithmetic that
// gets there.
//
// Faceted, not filtered: the STATUS control must show its segments' true
// numbers even while one of them is selected, so the block is computed with
// its own filter left out and every other filter applied - standard
// faceted-search semantics. It is the only control on the bar that carries
// numbers; the SERVICE segments are plain labels.
//
// One source answers it on its own: a `$match` on everything else the operator
// asked for, grouped by status. The per-source blocks are summed a layer up,
// in grant-admin/services/merge-facet-counts.js.

// What one source contributes to the faceted answer.
export const toSourceFacets = (rows) => ({ counts: toStatusCounts(rows) });

// A source that could not be read at all: zeros in every block, so the numbers
// stay renderable next to its `sourceError`.
export const zeroFacets = () => ({ counts: zeroCounts() });
