import { logger } from "../../common/logger.js";
import { countFacets as countGasInbox } from "../../grants/repositories/inbox.repository.js";
import { countFacets as countGasOutbox } from "../../grants/repositories/outbox.repository.js";
import { findCwPage } from "../repositories/cw-actuators.repository.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  cwPageFor,
  orderErrors,
  selectSources,
  sectionOfCwPage as sliceOfCwPage,
  splitSettled,
} from "../services/event-sources.js";
import { mergeFacetCounts } from "../services/merge-facet-counts.js";

// The same four sources the list fans out over, in the same order, so a
// sourceError means the same thing in both sections of the events page.
const SOURCES = [
  { key: "gasInbox", service: GAS, box: "inbox", count: countGasInbox },
  { key: "gasOutbox", service: GAS, box: "outbox", count: countGasOutbox },
  // Both Caseworking sources read the same composite: one request, two slices
  // of it.
  {
    key: "cwInbox",
    service: CASEWORKING,
    box: "inbox",
    count: (filter) => sliceOfCwPage(filter.caseworking, "inbox", "facets"),
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    count: (filter) => sliceOfCwPage(filter.caseworking, "outbox", "facets"),
  },
];

// Only Caseworking's sources are handed the shared page: a GAS source is a
// Mongo query and is passed nothing it does not query on.
const countAll = (selected, { caseworking, ...filter }) =>
  Promise.allSettled(
    selected.map((source) =>
      source.count(
        source.service === CASEWORKING ? { ...filter, caseworking } : filter,
      ),
    ),
  );

// Counts for the whole selection, not for a page: no cursor, and `status` is
// not a filter but the thing being grouped - `counts` is computed with
// `status` excluded and every other filter applied, which is what makes it
// the STATUS facet (see services/merge-facet-counts.js).
//
// A source that fails contributes zeros and names itself in `sourceErrors`.
// Both GAS boxes failing throws a 502, but only when GAS was being counted;
// on the events page that throw nulls the counts section while the page still
// answers.
//
// Not audited: unlike the detail view this reads no payload and no business
// identifier, only how many rows sit in each status.
export const countEventsUseCase = async ({
  service,
  q,
  error,
  from,
  to,
  audit,
  caseworking,
}) => {
  logger.info(`Count events (service ${service ?? "all"})`);

  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await countAll(selected, {
    q,
    error,
    from,
    to,
    audit,
    // The page's own Caseworking read when there is one; a read of this use
    // case's own when the caller shared none. The composite answers the counts
    // whatever page size it is asked for, so this one is nominal.
    caseworking: cwPageFor(selected, caseworking, () =>
      findCwPage({
        q,
        error,
        from,
        to,
        audit,
        pageSize: 1,
        direction: "forward",
      }),
    ),
  });
  const { results, errors } = splitSettled(selected, settled);

  assertGasAvailable(selected, errors);

  logger.info(`Finished: Count events (${results.length} sources)`);

  return {
    ...mergeFacetCounts(results),
    sourceErrors: orderErrors([...sourceErrors, ...errors]),
  };
};
