import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { wreck } from "../../common/wreck.js";
import {
  DEAD_LETTER,
  REDRIVABLE_DESCRIPTION,
} from "../../events/event-redrive.js";
import { EVENT_STATUSES } from "../../events/status-counts.js";

const GATEWAY_TIMEOUT = 504;
const CLIENT_TIMEOUT = 408;
const TIMEOUT_STATUSES = new Set([GATEWAY_TIMEOUT, CLIENT_TIMEOUT]);

const READ_FAILED = "read failed";
const TIMED_OUT = "timeout";

// `new URL(path, undefined)` throws, so callers check this first.
export const isCwConfigured = () =>
  Boolean(config.cwBackend.url && config.cwBackend.token);

const statusOf = (error) => error?.output?.statusCode ?? null;

// `wreck` attaches the CW response body to the error; read only the status.
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

// `audit` is forwarded: only Caseworking recognises its own audit topic.
const PAGE_PARAMS = ["status", "q", "error", "from", "to", "audit"];

const setOptional = (url, options, names) => {
  for (const name of names) {
    if (options[name]) {
      url.searchParams.set(name, options[name]);
    }
  }
};

const setCursor = (url, name, value) => {
  if (value) {
    url.searchParams.set(name, value);
  }
};

const setSections = (url, sections) => {
  if (sections?.length) {
    url.searchParams.set("sections", sections.join(","));
  }
};

const buildPageUrl = ({ pageSize, slices = {}, sections, ...filters }) => {
  const url = new URL("/actuators/events", config.cwBackend.url);

  url.searchParams.set("pageSize", String(pageSize));
  setSections(url, sections);
  setCursor(url, "inboxCursor", slices.cwInbox);
  setCursor(url, "outboxCursor", slices.cwOutbox);
  setOptional(url, filters, PAGE_PARAMS);

  return url.toString();
};

// `idTimestamp` throws on a non-string `_id`.
const isRow = (row) => typeof row?._id === "string";

// A malformed body becomes a null section, not a TypeError that 500s the page.
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

// A shorter timeout, so a slow Caseworking degrades the page rather than stalls it.
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

// Detail and redrive have no partial mode, so these catch and translate.

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

// The only value ever read from a CW response body: a known status.
const conflictStatusOf = (error) => {
  const status = bodyOf(error)?.status;

  return EVENT_STATUSES.includes(status) ? status : null;
};

const toConflict = (error, label, expected) => {
  const status = conflictStatusOf(error);
  const conflict = Boom.conflict(
    status
      ? `CW-BE ${label} is ${status}, not ${expected}`
      : `CW-BE ${label} is not ${expected}`,
  );

  if (status) {
    conflict.output.payload.status = status;
  }

  return conflict;
};

const toFailure = (error, label, expected) => {
  const statusCode = statusOf(error);

  if (statusCode === NOT_FOUND) {
    return Boom.notFound(`CW-BE ${label} not found`);
  }

  if (statusCode === CONFLICT) {
    return toConflict(error, label, expected);
  }

  // No answer is not a refusal: a redrive may still have committed.
  if (TIMEOUT_STATUSES.has(statusCode)) {
    return Boom.gatewayTimeout(`CW-BE did not answer in time for ${label}`);
  }

  return Boom.badGateway(`CW-BE is unavailable: ${describeError(error)}`);
};

const requestOptions = () => ({
  json: true,
  timeout: config.cwBackend.timeoutMs,
  headers: { authorization: `Bearer ${config.cwBackend.token}` },
});

// `wreck` serialises an object payload as JSON and sets the content type.
const optionsWith = (body) =>
  body === undefined
    ? requestOptions()
    : { ...requestOptions(), payload: body };

// `expected` is what Caseworking's 409 says the row was not, and it differs
// per route.
const cwRequest = async (method, path, label, { body, expected } = {}) => {
  if (!isCwConfigured()) {
    throw Boom.badGateway("CW-BE is not configured");
  }

  try {
    const { payload } = await wreck[method](
      new URL(path, config.cwBackend.url).toString(),
      optionsWith(body),
    );

    return payload;
  } catch (error) {
    throw toFailure(error, label, expected);
  }
};

const eventPath = (box, id) =>
  `/actuators/events/${box}/${encodeURIComponent(id)}`;

const labelFor = (box, id) => `${box} event "${id}"`;

// A read never conflicts, so its `expected` is only ever a fallback wording.
export const findCwEvent = (box, id) =>
  cwRequest("get", eventPath(box, id), labelFor(box, id), {
    expected: DEAD_LETTER,
  });

const withActor = (path, by) =>
  by ? `${path}?by=${encodeURIComponent(by)}` : path;

export const redriveCwEvent = (box, id, { by } = {}) =>
  cwRequest(
    "post",
    withActor(`${eventPath(box, id)}/redrive`, by),
    labelFor(box, id),
    { expected: REDRIVABLE_DESCRIPTION },
  );

// The key is left out rather than sent null: Caseworking's schema stores null
// for an absent note, exactly as GAS does.
const purgeBody = (reasonCode, note) =>
  note === null || note === undefined ? { reasonCode } : { reasonCode, note };

// Caseworking refuses a purge that names nobody, because it audits the purge
// itself. `x-actor` is required on the route that reaches here, so `by` is
// always sent rather than left off as a redrive's is.
export const purgeCwEvent = (box, id, { by, reasonCode, note }) =>
  cwRequest(
    "post",
    `${eventPath(box, id)}/purge?by=${encodeURIComponent(by)}`,
    labelFor(box, id),
    { body: purgeBody(reasonCode, note), expected: DEAD_LETTER },
  );
