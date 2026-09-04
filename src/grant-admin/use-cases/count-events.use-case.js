import { logger } from "../../common/logger.js";
import { countFacets as countGasInbox } from "../../grants/repositories/inbox.repository.js";
import { countFacets as countGasOutbox } from "../../grants/repositories/outbox.repository.js";
import {
  countCwInbox,
  countCwOutbox,
} from "../repositories/cw-actuators.repository.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  orderErrors,
  selectSources,
  splitSettled,
} from "../services/event-sources.js";
import { mergeFacetCounts } from "../services/merge-facet-counts.js";

// The same four sources the list fans out over, in the same order, so a
// sourceError means the same thing on both endpoints.
const SOURCES = [
  { key: "gasInbox", service: GAS, box: "inbox", count: countGasInbox },
  { key: "gasOutbox", service: GAS, box: "outbox", count: countGasOutbox },
  { key: "cwInbox", service: CASEWORKING, box: "inbox", count: countCwInbox },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    count: countCwOutbox,
  },
];

const countAll = (selected, filter) =>
  Promise.allSettled(selected.map((source) => source.count(filter)));

// Counts for the whole selection, not for a page: no cursor, and `status` is
// not a filter but the thing being grouped. `counts` is computed with `status`
// excluded and every other filter applied, which is what makes it the STATUS
// facet - see services/merge-facet-counts.js.
//
// Only the services the filter selects are read. This endpoint used to fan out
// over ALL FOUR sources whatever `service` said, because the `byService` block
// had to answer for the service the operator did NOT select. That block is
// gone - the SERVICE segments are plain labels now - so the reason went with
// it, and reading a service nobody asked about would be a scan of a whole
// collection for a number nothing renders.
//
// It also puts `sourceErrors` back in step with the list, which has always
// selected this way: under `?service=gas` an unreadable Caseworking is no
// longer reported, because Caseworking is not being counted. Under no service
// filter, or `?service=caseworking`, it still is.
//
// A source that fails contributes zeros and names itself in `sourceErrors`,
// the same partial answer the list gives. Both GAS boxes failing is still a
// 502, but only when GAS was actually being counted - `service=caseworking`
// is unaffected, exactly as before.
//
// Not audited: unlike the detail view this reads no payload and no business
// identifier, only how many rows sit in each status.
export const countEventsUseCase = async ({
  service,
  q,
  error,
  from,
  to,
}) => {
  logger.info(`Count events (service ${service ?? "all"})`);

  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await countAll(selected, { q, error, from, to });
  const { results, errors } = splitSettled(selected, settled);

  assertGasAvailable(selected, errors);

  logger.info(`Finished: Count events (${results.length} sources)`);

  return {
    ...mergeFacetCounts(results),
    sourceErrors: orderErrors([...sourceErrors, ...errors]),
  };
};
