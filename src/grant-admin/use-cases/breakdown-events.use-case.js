import { logger } from "../../common/logger.js";
import { breakdown as breakdownGasInbox } from "../../grants/repositories/inbox.repository.js";
import { breakdown as breakdownGasOutbox } from "../../grants/repositories/outbox.repository.js";
import {
  breakdownCwInbox,
  breakdownCwOutbox,
} from "../repositories/cw-actuators.repository.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  orderErrors,
  selectSources,
  splitSettled,
} from "../services/event-sources.js";
import { mergeBreakdownGroups } from "../services/merge-breakdown-groups.js";

// The same four sources the list and the counts fan out over, in the same
// order, so a sourceError means the same thing on all three endpoints.
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
    breakdown: breakdownCwInbox,
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    breakdown: breakdownCwOutbox,
  },
];

const breakdownAll = (selected, filter) =>
  Promise.allSettled(selected.map((source) => source.breakdown(filter)));

// What is stuck, and how much of it. Scope is DEAD_LETTER and only
// DEAD_LETTER, pinned inside each box's own repository rather than passed in:
// a row that is still retrying has not failed for good yet.
//
// The filter is exactly the counts filter, so the groups always add up to the
// DEAD_LETTER number the counts endpoint reports for the same selection.
//
// Not audited: like the counts endpoint this reads no payload and no business
// identifier, only how many rows failed the same way.
export const breakdownEventsUseCase = async ({
  service,
  q,
  from,
  to,
}) => {
  logger.info(`Breakdown events (service ${service ?? "all"})`);

  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await breakdownAll(selected, { q, from, to });
  const { results, errors } = splitSettled(selected, settled);

  assertGasAvailable(selected, errors);

  const groups = mergeBreakdownGroups(results);

  logger.info(`Finished: Breakdown events (${groups.length} groups)`);

  return {
    groups,
    sourceErrors: orderErrors([...sourceErrors, ...errors]),
  };
};
