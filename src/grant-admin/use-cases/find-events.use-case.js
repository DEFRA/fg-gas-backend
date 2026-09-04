import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findPage as findGasInboxPage } from "../../grants/repositories/inbox.repository.js";
import { findPage as findGasOutboxPage } from "../../grants/repositories/outbox.repository.js";
import {
  findCwInboxPage,
  findCwOutboxPage,
} from "../repositories/cw-actuators.repository.js";
import { decodeCompositeCursor } from "../services/event-cursor.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  orderErrors,
  selectSources,
  splitSettled,
} from "../services/event-sources.js";
import {
  normaliseCwInbox,
  normaliseCwOutbox,
  normaliseGasInbox,
  normaliseGasOutbox,
  toEventTuple,
} from "../services/map-event-row.js";
import {
  PAGE_SIZE,
  buildPagination,
  mergePages,
} from "../services/merge-event-pages.js";

// Fixed order: used for `sourceErrors` ordering and merge tie-breaks.
const SOURCES = [
  {
    key: "gasInbox",
    service: GAS,
    box: "inbox",
    fetch: findGasInboxPage,
    normalise: (row) => normaliseGasInbox(row, config.inbox.inboxMaxRetries),
  },
  {
    key: "gasOutbox",
    service: GAS,
    box: "outbox",
    fetch: findGasOutboxPage,
    normalise: (row) => normaliseGasOutbox(row, config.outbox.outboxMaxRetries),
  },
  {
    key: "cwInbox",
    service: CASEWORKING,
    box: "inbox",
    fetch: findCwInboxPage,
    normalise: normaliseCwInbox,
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    fetch: findCwOutboxPage,
    normalise: normaliseCwOutbox,
  },
];

const toPage = (source, page) => ({
  key: source.key,
  tuples: page.data.map((row) =>
    toEventTuple({
      key: source.key,
      service: source.service,
      box: source.box,
      intermediate: source.normalise(row),
    }),
  ),
  pagination: page.pagination,
});

// `q` and the `from`/`to` range are applied per source and OR-ed by
// the merge: a GAS outbox hit and a Caseworking inbox hit for the same `q`
// both appear on the page. Each source applies the range to its own sort key,
// which is the same key the merge orders by, so a time-boxed page stays in
// one order.
const fetchAll = (
  selected,
  { slices, direction, status, q, error, from, to },
) =>
  Promise.allSettled(
    selected.map((source) =>
      source.fetch({
        cursor: slices[source.key],
        direction,
        status,
        q,
        error,
        from,
        to,
        pageSize: PAGE_SIZE,
      }),
    ),
  );

export const findEventsUseCase = async ({
  cursor,
  direction,
  status,
  service,
  q,
  error,
  from,
  to,
}) => {
  logger.info(`Find events (direction ${direction})`);

  // Decoded before any I/O, so a tampered cursor is a clean 400 rather than a
  // rejection swallowed into sourceErrors by the fan-out.
  const slices = decodeCompositeCursor(cursor);
  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await fetchAll(selected, {
    slices,
    direction,
    status,
    q,
    error,
    from,
    to,
  });
  const { results: pages, errors } = splitSettled(selected, settled, toPage);

  assertGasAvailable(selected, errors);

  const { taken, events } = mergePages({ pages, direction });

  logger.info(`Finished: Find events (${events.length} rows)`);

  return {
    events,
    pagination: buildPagination({
      slices,
      pages,
      taken,
      direction,
      hadCursor: Boolean(cursor),
    }),
    sourceErrors: orderErrors([...sourceErrors, ...errors]),
  };
};
