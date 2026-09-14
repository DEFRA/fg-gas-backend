import { logger } from "../../common/logger.js";
import { breakdown as breakdownGasInbox } from "../../grants/repositories/inbox.repository.js";
import { breakdown as breakdownGasOutbox } from "../../grants/repositories/outbox.repository.js";
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
import { mergeBreakdownGroups } from "../services/merge-breakdown-groups.js";

// The same four sources the list and the counts fan out over, in the same
// order, so a sourceError means the same thing in all three sections of the
// events page.
const SOURCES = [
  { key: "gasInbox", service: GAS, box: "inbox", breakdown: breakdownGasInbox },
  {
    key: "gasOutbox",
    service: GAS,
    box: "outbox",
    breakdown: breakdownGasOutbox,
  },
  // Both Caseworking sources read the same composite: one request, two slices
  // of it.
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

// Only Caseworking's sources are handed the shared page: a GAS source is a
// Mongo query and is passed nothing it does not query on.
const breakdownAll = (selected, { caseworking, ...filter }) =>
  Promise.allSettled(
    selected.map((source) =>
      source.breakdown(
        source.service === CASEWORKING ? { ...filter, caseworking } : filter,
      ),
    ),
  );

// What is stuck, and how much of it. Scope is DEAD_LETTER and only
// DEAD_LETTER, pinned inside each box's own repository rather than passed in:
// a row that is still retrying has not failed for good yet.
//
// The filter is exactly the counts filter, so the groups always add up to the
// DEAD_LETTER number the counts report for the same selection.
//
// Not audited: like the counts this reads no payload and no business
// identifier, only how many rows failed the same way.
export const breakdownEventsUseCase = async ({
  service,
  q,
  from,
  to,
  audit,
  caseworking,
}) => {
  logger.info(`Breakdown events (service ${service ?? "all"})`);

  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await breakdownAll(selected, {
    q,
    from,
    to,
    audit,
    // The page's own Caseworking read when there is one; a read of this use
    // case's own when the caller shared none. Caseworking keeps `error` off
    // its breakdown for the same reason this service does, so the composite
    // the page shares answers this section with exactly the filter it asked
    // for.
    caseworking: cwPageFor(selected, caseworking, () =>
      findCwPage({ q, from, to, audit, pageSize: 1, direction: "forward" }),
    ),
  });
  const { results, errors } = splitSettled(selected, settled);

  assertGasAvailable(selected, errors);

  const groups = mergeBreakdownGroups(results);

  logger.info(`Finished: Breakdown events (${groups.length} groups)`);

  return {
    groups,
    sourceErrors: orderErrors([...sourceErrors, ...errors]),
  };
};
