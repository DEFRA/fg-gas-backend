import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findPage as findGasInboxPage } from "../../grants/repositories/inbox.repository.js";
import { findPage as findGasOutboxPage } from "../../grants/repositories/outbox.repository.js";
import { decodeCompositeCursor } from "../services/event-cursor.js";
import {
  CASEWORKING,
  GAS,
  assertGasAvailable,
  selectSources,
  serviceScope,
  sectionOfCwPage as sliceOfCwPage,
  splitSettled,
} from "../services/event-sources.js";
import {
  normaliseCwListRow,
  normaliseGasInbox,
  normaliseGasOutbox,
  toEventTuple,
} from "../services/map-event-row.js";
import {
  PAGE_SIZE,
  buildPagination,
  mergePages,
} from "../services/merge-event-pages.js";

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
    fetch: (options) => sliceOfCwPage(options.caseworking, "inbox", "list"),
    normalise: normaliseCwListRow,
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    fetch: (options) => sliceOfCwPage(options.caseworking, "outbox", "list"),
    normalise: normaliseCwListRow,
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

// Each source ranges on its own sort key, the same key the merge orders by.
const fetchAll = (
  selected,
  { slices, status, q, error, from, to, audit, caseworking },
) =>
  Promise.allSettled(
    selected.map((source) =>
      source.fetch({
        cursor: slices[source.key],
        status,
        q,
        error,
        from,
        to,
        audit,
        pageSize: PAGE_SIZE,
        ...(source.service === CASEWORKING ? { caseworking } : {}),
      }),
    ),
  );

export const findEventsUseCase = async ({
  cursor,
  status,
  service,
  q,
  error,
  from,
  to,
  audit,
  caseworking,
}) => {
  logger.info(`Find events (${serviceScope(service)})`);

  // Decoded before any I/O: a tampered cursor is a 400, not a source error.
  const slices = decodeCompositeCursor(cursor);
  const { selected, sourceErrors } = selectSources(service, SOURCES);

  const settled = await fetchAll(selected, {
    slices,
    status,
    q,
    error,
    from,
    to,
    audit,
    caseworking,
  });
  const { results: pages, errors } = splitSettled(selected, settled, toPage);

  assertGasAvailable(selected, errors);

  const { taken, events } = mergePages({ pages });

  logger.info(`Finished: Find events (${events.length} rows)`);

  return {
    events,
    pagination: buildPagination({ slices, pages, taken }),
    sourceErrors: [...sourceErrors, ...errors],
  };
};
