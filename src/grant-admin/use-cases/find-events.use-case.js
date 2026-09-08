import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findPage as findGasInboxPage } from "../../grants/repositories/inbox.repository.js";
import { findPage as findGasOutboxPage } from "../../grants/repositories/outbox.repository.js";
import { findCwPage } from "../repositories/cw-actuators.repository.js";
import { decodeCompositeCursor } from "../services/event-cursor.js";
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
  // Both Caseworking sources read the same composite: one request, two slices
  // of it. `fetch` takes the page promise the caller started, or starts one.
  {
    key: "cwInbox",
    service: CASEWORKING,
    box: "inbox",
    fetch: (options) => sliceOfCwPage(options.caseworking, "inbox", "list"),
    normalise: normaliseCwInbox,
  },
  {
    key: "cwOutbox",
    service: CASEWORKING,
    box: "outbox",
    fetch: (options) => sliceOfCwPage(options.caseworking, "outbox", "list"),
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
  { slices, direction, status, q, error, from, to, audit, caseworking },
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
        audit,
        pageSize: PAGE_SIZE,
        // Only Caseworking's sources are handed the shared page - one request
        // already carried both of its boxes and both keyset positions. A GAS
        // source is a Mongo query and is passed nothing it does not query on.
        ...(source.service === CASEWORKING ? { caseworking } : {}),
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
  audit,
  caseworking,
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
    audit,
    // The page's own Caseworking read when there is one; this endpoint's own
    // when it is being served on its own; none at all when no Caseworking
    // source is selected.
    caseworking: cwPageFor(selected, caseworking, () =>
      findCwPage({
        slices,
        direction,
        status,
        q,
        error,
        from,
        to,
        audit,
        pageSize: PAGE_SIZE,
      }),
    ),
  });
  const { results: pages, errors } = splitSettled(selected, settled, toPage);

  assertGasAvailable(selected, errors);

  const { taken, events, hops } = mergePages({ pages, direction });

  logger.info(`Finished: Find events (${events.length} rows)`);

  return {
    events,
    // The same page in the journey's shape. The list ignores it; the detail
    // page's journey is this very search asked for one event id, and reading
    // it here keeps that from being a second query.
    hops,
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
