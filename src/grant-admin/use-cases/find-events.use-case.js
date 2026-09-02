import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { findPage as findGasInboxPage } from "../../grants/repositories/inbox.repository.js";
import { findPage as findGasOutboxPage } from "../../grants/repositories/outbox.repository.js";
import {
  describeError,
  findCwInboxPage,
  findCwOutboxPage,
  isCwConfigured,
  notConfiguredMessage,
} from "../repositories/cw-actuators.repository.js";
import {
  SOURCE_KEYS,
  decodeCompositeCursor,
} from "../services/event-cursor.js";
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

const GAS = "gas";
const CASEWORKING = "caseworking";

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

const isFor = (service) => (source) => !service || source.service === service;

const toSourceError = (source, message) => ({
  key: source.key,
  service: source.service,
  box: source.box,
  message,
});

const stripKey = ({ service, box, message }) => ({ service, box, message });

const orderErrors = (errors) =>
  [...errors]
    .sort((a, b) => SOURCE_KEYS.indexOf(a.key) - SOURCE_KEYS.indexOf(b.key))
    .map(stripKey);

// With `service=gas` the Caseworking sources are never selected, so an
// unconfigured CW backend produces no sourceError at all.
const selectSources = (service) => {
  const forService = SOURCES.filter(isFor(service));

  if (isCwConfigured()) {
    return { selected: forService, sourceErrors: [] };
  }

  return {
    selected: forService.filter((source) => source.service !== CASEWORKING),
    sourceErrors: forService
      .filter((source) => source.service === CASEWORKING)
      .map((source) => toSourceError(source, notConfiguredMessage())),
  };
};

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

// Asymmetric on purpose: `wreck` hangs the CW response body off its error, so a
// caseworking failure is logged as a derived one-liner and never as the error
// object. A GAS failure is our own database - the stack is worth keeping.
const logSourceFailure = (source, error) => {
  if (source.service === CASEWORKING) {
    logger.warn(
      { service: source.service, box: source.box },
      `caseworking ${source.box} unavailable: ${describeError(error)}`,
    );

    return;
  }

  logger.error(error, `gas ${source.box} read failed`);
};

const splitResults = (selected, settled) => {
  const pages = [];
  const errors = [];

  selected.forEach((source, index) => {
    const result = settled[index];

    if (result.status === "fulfilled") {
      pages.push(toPage(source, result.value));
      return;
    }

    logSourceFailure(source, result.reason);
    errors.push(toSourceError(source, describeError(result.reason)));
  });

  return { pages, errors };
};

const countFor = (items, service) =>
  items.filter((item) => item.service === service).length;

// Exactly one GAS source failing is a 200 with a sourceError; both failing
// leaves nothing worth rendering.
const assertGasAvailable = (selected, errors) => {
  const gasSelected = countFor(selected, GAS);

  if (gasSelected > 0 && gasSelected === countFor(errors, GAS)) {
    throw Boom.badGateway("Events could not be loaded from GAS");
  }
};

const fetchAll = (selected, { slices, direction, status }) =>
  Promise.allSettled(
    selected.map((source) =>
      source.fetch({
        cursor: slices[source.key],
        direction,
        status,
        pageSize: PAGE_SIZE,
      }),
    ),
  );

export const findEventsUseCase = async ({
  cursor,
  direction,
  status,
  service,
}) => {
  logger.info(`Find events (direction ${direction})`);

  // Decoded before any I/O, so a tampered cursor is a clean 400 rather than a
  // rejection swallowed into sourceErrors by the fan-out.
  const slices = decodeCompositeCursor(cursor);
  const { selected, sourceErrors } = selectSources(service);

  const settled = await fetchAll(selected, { slices, direction, status });
  const { pages, errors } = splitResults(selected, settled);

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
