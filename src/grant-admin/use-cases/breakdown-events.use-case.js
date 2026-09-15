import { logger } from "../../common/logger.js";
import { breakdown as breakdownGasInbox } from "../../grants/repositories/inbox.repository.js";
import { breakdown as breakdownGasOutbox } from "../../grants/repositories/outbox.repository.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  selectSources,
  serviceScope,
  sectionOfCwPage as sliceOfCwPage,
  splitSettled,
} from "../services/event-sources.js";
import { mergeBreakdownGroups } from "../services/merge-breakdown-groups.js";

const SOURCES = [
  { key: "gasInbox", service: GAS, box: "inbox", breakdown: breakdownGasInbox },
  {
    key: "gasOutbox",
    service: GAS,
    box: "outbox",
    breakdown: breakdownGasOutbox,
  },
  {
    key: "cwInbox",
    service: CASEWORKING,
    box: "inbox",
    breakdown: (filter) => sliceOfCwPage(filter.caseworking, "inbox", "groups"),
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    breakdown: (filter) =>
      sliceOfCwPage(filter.caseworking, "outbox", "groups"),
  },
];

const breakdownAll = (selected, { caseworking, ...filter }) =>
  Promise.allSettled(
    selected.map((source) =>
      source.breakdown(
        source.service === CASEWORKING ? { ...filter, caseworking } : filter,
      ),
    ),
  );

// DEAD_LETTER only, pinned in each repository: a row still retrying has not failed for good.
export const breakdownEventsUseCase = async ({
  service,
  q,
  from,
  to,
  audit,
  caseworking,
}) => {
  logger.info(`Breakdown events (${serviceScope(service)})`);

  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await breakdownAll(selected, {
    q,
    from,
    to,
    audit,
    caseworking,
  });
  const { results, errors } = splitSettled(selected, settled);

  assertGasAvailable(selected, errors);

  const groups = mergeBreakdownGroups(results);

  logger.info(`Finished: Breakdown events (${groups.length} groups)`);

  return { groups, sourceErrors: [...sourceErrors, ...errors] };
};
