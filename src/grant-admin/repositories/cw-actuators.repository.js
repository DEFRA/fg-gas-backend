import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { wreck } from "../../common/wreck.js";
import { REDRIVE_FROM_STATUS } from "../../events/event-redrive.js";
import { EVENT_STATUSES } from "../../events/status-counts.js";

const GATEWAY_TIMEOUT = 504;
const CLIENT_TIMEOUT = 408;
const TIMEOUT_STATUSES = new Set([GATEWAY_TIMEOUT, CLIENT_TIMEOUT]);

const NOT_CONFIGURED = "not configured";
const READ_FAILED = "read failed";
const TIMED_OUT = "timeout";

// `CW_BACKEND_URL` / `CW_BACKEND_TOKEN` are optional config, unset in every
// environment today. `new URL(path, undefined)` throws, so the use case checks
// this before building a URL and reports "not configured" instead.
export const isCwConfigured = () =>
  Boolean(config.cwBackend.url && config.cwBackend.token);

const statusOf = (error) => error?.output?.statusCode ?? null;

// A fixed, payload-free vocabulary. `wreck` attaches the CW response body to
// its error at `err.data.payload`, so nothing here may be derived from the
// error's data - only its status code.
export const describeError = (error) => {
  const statusCode = statusOf(error);

  if (statusCode === null) {
    return READ_FAILED;
  }

  if (TIMEOUT_STATUSES.has(statusCode)) {
    return TIMED_OUT;
  }

  return `HTTP ${statusCode}`;
};

export const notConfiguredMessage = () => NOT_CONFIGURED;

// Only the filters that are actually set are sent. `audit` travels with the
// rest: each service is authoritative for its own rows, and only Caseworking
// recognises its own audit topic - withholding the parameter would leave the
// exclusion GAS-side only and let CW's audit records escape the filter.
const PAGE_PARAMS = ["status", "q", "error", "from", "to", "audit"];

const setOptional = (url, options, names) => {
  for (const name of names) {
    if (options[name]) {
      url.searchParams.set(name, options[name]);
    }
  }
};

// One cursor per box: the merged list's own cursor holds a keyset position
// per source, so both of Caseworking's positions travel here.
const setCursor = (url, name, value) => {
  if (value) {
    url.searchParams.set(name, value);
  }
};

const buildPageUrl = ({ pageSize, direction, slices = {}, ...filters }) => {
  const url = new URL("/actuators/events", config.cwBackend.url);

  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("direction", direction);
  setCursor(url, "inboxCursor", slices.cwInbox);
  setCursor(url, "outboxCursor", slices.cwOutbox);
  setOptional(url, filters, PAGE_PARAMS);

  return url.toString();
};

// Each box's section, in the shape this service's mergers already read. A
// section Caseworking could not read arrives null and is turned back into a
// rejection downstream, so one box's bad counts is a `sourceError` and
// nothing more.
// A row this service can actually map: the mappers reach for `_id` on every
// one of them, and `idTimestamp` throws on anything that is not a string.
const isRow = (row) => typeof row?._id === "string";

/**
 * The rows, if the answer really contains rows.
 *
 * Validated here rather than trusted, because of where the mapping happens: a
 * page's rows are normalised INSIDE `Promise.allSettled`'s fulfilled branch,
 * so a `TypeError` thrown while mapping is not a rejected source - it escapes
 * the fan-out entirely and 500s the request, and on the composite page the
 * list's failure takes the whole page with it. A body shaped wrongly by
 * another service is exactly the case the degradation contract exists for, so
 * it is turned into that contract's own vocabulary here: a null section, which
 * downstream reports as this source's `sourceError`.
 */
const toList = (section) => {
  if (!Array.isArray(section.events) || !section.events.every(isRow)) {
    return null;
  }

  return { data: section.events, pagination: section.pagination ?? {} };
};

const toFacets = (section) =>
  section.counts ? { counts: section.counts } : null;

const toGroups = (section) => section.breakdown?.groups ?? null;

const toBoxSection = (section = {}) => ({
  list: toList(section),
  facets: toFacets(section),
  groups: toGroups(section),
});

// Deliberately does not catch: the use case's `Promise.allSettled` turns a
// rejection into a `sourceError`, keeping the failure policy in one place and
// this module free of logging.
//
// The timeout is this endpoint's own, not the shared client's ten seconds.
// Degradation only fires on FAILURE, so a Caseworking answering in nine
// seconds does not degrade anything - it just makes every list render take
// nine seconds, on the one surface an operator opens when the estate is
// already misbehaving. A shorter ceiling turns that into the partial page the
// contract was designed to give.
export const findCwPage = async (options) => {
  const { payload } = await wreck.get(buildPageUrl(options), {
    json: true,
    timeout: config.cwBackend.timeoutMs,
    headers: { authorization: `Bearer ${config.cwBackend.token}` },
  });

  const body = payload ?? {};

  return {
    inbox: toBoxSection(body.inbox),
    outbox: toBoxSection(body.outbox),
  };
};

// ---------------------------------------------------------------------------
// Single-event reads and redrives. Unlike the list, the detail view has no
// partial mode: a Caseworking failure is a 502 with a fixed one-liner, so
// these DO catch, and translate rather than swallow.
// ---------------------------------------------------------------------------

const NOT_FOUND = 404;
const CONFLICT = 409;

const parseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isRaw = (payload) =>
  Buffer.isBuffer(payload) || typeof payload === "string";

const payloadOf = (error) => error?.data?.payload;

const bodyOf = (error) => {
  const payload = payloadOf(error);

  return isRaw(payload) ? parseJson(payload.toString()) : payload;
};

// The ONE thing ever read out of a Caseworking response body, and only when it
// is one of the six statuses we already publish. Everything else about a CW
// failure stays the fixed vocabulary in `describeError`.
const conflictStatusOf = (error) => {
  const status = bodyOf(error)?.status;

  return EVENT_STATUSES.includes(status) ? status : null;
};

const toConflict = (error, label, expected) => {
  const status = conflictStatusOf(error);
  const conflict = Boom.conflict(
    status
      ? `Caseworking ${label} is ${status}, not ${expected}`
      : `Caseworking ${label} is not ${expected}`,
  );

  if (status) {
    conflict.output.payload.status = status;
  }

  return conflict;
};

const toFailure = (error, label, expected) => {
  const statusCode = statusOf(error);

  if (statusCode === NOT_FOUND) {
    return Boom.notFound(`Caseworking ${label} not found`);
  }

  if (statusCode === CONFLICT) {
    return toConflict(error, label, expected);
  }

  return Boom.badGateway(`Caseworking is unavailable: ${describeError(error)}`);
};

// The same ceiling the page read uses: a detail view or a redrive that hangs
// for the shared client's ten seconds is a page an operator abandons.
const requestOptions = () => ({
  json: true,
  timeout: config.cwBackend.timeoutMs,
  headers: { authorization: `Bearer ${config.cwBackend.token}` },
});

const cwRequest = async (method, path, label) => {
  if (!isCwConfigured()) {
    throw Boom.badGateway(`Caseworking is ${notConfiguredMessage()}`);
  }

  try {
    const { payload } = await wreck[method](
      new URL(path, config.cwBackend.url).toString(),
      requestOptions(),
    );

    return payload;
  } catch (error) {
    throw toFailure(error, label, REDRIVE_FROM_STATUS);
  }
};

const eventPath = (box, id) => `/actuators/events/${box}/${encodeURIComponent(id)}`;

const labelFor = (box, id) => `${box} event "${id}"`;

// The whole Caseworking document for one row, payload included.
export const findCwEvent = (box, id) =>
  cwRequest("get", eventPath(box, id), labelFor(box, id));

// `by` - the operator GAS read from the `x-actor` header - travels as a query
// parameter on the redrive. Omitted entirely when nobody named themselves, so
// an unattributed call is byte-identical to what GAS sent before actors
// existed.
const withActor = (path, by) =>
  by ? `${path}?by=${encodeURIComponent(by)}` : path;

// Answers with one Caseworking list row, already updated.
export const redriveCwEvent = (box, id, { by } = {}) =>
  cwRequest(
    "post",
    withActor(`${eventPath(box, id)}/redrive`, by),
    labelFor(box, id),
  );
