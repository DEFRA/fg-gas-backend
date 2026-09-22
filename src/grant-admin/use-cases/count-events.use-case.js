import { logger } from "../../common/logger.js";
import { countFacets as countGasInbox } from "../../events/repositories/inbox.repository.js";
import { countFacets as countGasOutbox } from "../../events/repositories/outbox.repository.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  selectSources,
  serviceScope,
  sectionOfCwPage as sliceOfCwPage,
  splitSettled,
} from "../services/event-sources.js";
import { mergeFacetCounts } from "../services/merge-facet-counts.js";

const SOURCES = [
  { key: "gasInbox", service: GAS, box: "inbox", count: countGasInbox },
  { key: "gasOutbox", service: GAS, box: "outbox", count: countGasOutbox },
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

const countAll = (selected, { caseworking, ...filter }) =>
  Promise.allSettled(
    selected.map((source) =>
      source.count(
        source.service === CASEWORKING ? { ...filter, caseworking } : filter,
      ),
    ),
  );

// `status` is grouped by, not filtered on, which makes this the status facet.
export const countEventsUseCase = async ({
  service,
  q,
  error,
  from,
  to,
  audit,
  caseworking,
}) => {
  logger.info(`Count events (${serviceScope(service)})`);

  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await countAll(selected, {
    q,
    error,
    from,
    to,
    audit,
    caseworking,
  });
  const { results, errors } = splitSettled(selected, settled);

  assertGasAvailable(selected, errors);

  logger.info(`Finished: Count events (${results.length} sources)`);

  return {
    ...mergeFacetCounts(results),
    sourceErrors: [...sourceErrors, ...errors],
  };
};
