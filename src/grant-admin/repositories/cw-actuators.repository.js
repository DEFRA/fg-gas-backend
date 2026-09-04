import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import {
  PARK_FROM_STATUS,
  UNPARK_FROM_STATUS,
} from "../../common/event-park.js";
import { REDRIVE_FROM_STATUS } from "../../common/event-redrive.js";
import { wreck } from "../../common/wreck.js";

const GATEWAY_TIMEOUT = 504;
const CLIENT_TIMEOUT = 408;
const TIMEOUT_STATUSES = [GATEWAY_TIMEOUT, CLIENT_TIMEOUT];

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

  if (TIMEOUT_STATUSES.includes(statusCode)) {
    return TIMED_OUT;
  }

  return `HTTP ${statusCode}`;
};

export const notConfiguredMessage = () => NOT_CONFIGURED;

// Only the filters that are actually set are sent, so an unfiltered page is
// requested with exactly the query string it was before FGP-1392.
const OPTIONAL_PARAMS = ["cursor", "status", "q", "error", "from", "to"];

// The filters the counts endpoint takes: the list's, minus the cursor and
// minus `status` - which is what is being counted.
const COUNT_PARAMS = ["q", "error", "from", "to"];

// The breakdown takes the counts filter minus `error`: filtering a breakdown
// by one error message would answer the question the breakdown already answers.
const BREAKDOWN_PARAMS = ["q", "from", "to"];

const setOptional = (url, options, names) => {
  for (const name of names) {
    if (options[name]) {
      url.searchParams.set(name, options[name]);
    }
  }
};

const buildUrl = (box, options) => {
  const url = new URL(`/actuators/${box}`, config.cwBackend.url);

  url.searchParams.set("pageSize", String(options.pageSize));
  url.searchParams.set("direction", options.direction);
  setOptional(url, options, OPTIONAL_PARAMS);

  return url.toString();
};

const buildCountsUrl = (box, options) => {
  const url = new URL(`/actuators/${box}/counts`, config.cwBackend.url);

  setOptional(url, options, COUNT_PARAMS);

  return url.toString();
};

const buildBreakdownUrl = (box, options) => {
  const url = new URL(`/actuators/${box}/breakdown`, config.cwBackend.url);

  setOptional(url, options, BREAKDOWN_PARAMS);

  return url.toString();
};

const toEnvelope = (payload) => {
  const body = payload ?? {};

  return { data: body.data ?? [], pagination: body.pagination ?? {} };
};

// Deliberately does not catch: the use case's `Promise.allSettled` turns a
// rejection into a `sourceError`, keeping the failure policy in one place and
// this module free of logging. The 3 s timeout and no-retry policy come from
// the shared `wreck` instance.
const findCwPage = async (box, options) => {
  const { payload } = await wreck.get(buildUrl(box, options), {
    json: true,
    headers: { authorization: `Bearer ${config.cwBackend.token}` },
  });

  return toEnvelope(payload);
};

export const findCwInboxPage = async (options) => findCwPage("inbox", options);

export const findCwOutboxPage = async (options) =>
  findCwPage("outbox", options);

// One Caseworking box's contribution to the faceted counts: its per-status
// counts, in the shape `common/event-facets.js` defines and a GAS box's
// `countFacets` answers with, so the merge cannot tell the four sources apart.
//
// A missing block is read as zeros rather than as a failure, the same
// tolerance the list's envelope has: `sumCounts` zero-fills, so a partial
// answer degrades to zeros instead of breaking the response.
const toBoxFacets = (payload) => ({ counts: payload?.counts ?? {} });

// Deliberately does not catch, for the same reason `findCwPage` does not: the
// use case's `Promise.allSettled` turns a rejection into a `sourceError` and
// the failed box contributes zeros to every block.
const countCwBox = async (box, options) => {
  const { payload } = await wreck.get(buildCountsUrl(box, options), {
    json: true,
    headers: { authorization: `Bearer ${config.cwBackend.token}` },
  });

  return toBoxFacets(payload);
};

export const countCwInbox = async (options) => countCwBox("inbox", options);

export const countCwOutbox = async (options) => countCwBox("outbox", options);

// The dead-letter breakdown for one Caseworking box. Deliberately does not
// catch, for the same reason the list and the counts do not: the use case's
// `Promise.allSettled` turns a rejection into a `sourceError` and the failed
// box contributes no groups. An answer without a `groups` array is treated as
// no groups rather than as a failure.
const breakdownCwBox = async (box, options) => {
  const { payload } = await wreck.get(buildBreakdownUrl(box, options), {
    json: true,
    headers: { authorization: `Bearer ${config.cwBackend.token}` },
  });

  return payload?.groups ?? [];
};

export const breakdownCwInbox = async (options) =>
  breakdownCwBox("inbox", options);

export const breakdownCwOutbox = async (options) =>
  breakdownCwBox("outbox", options);

// How many rows one page of the dead-letter walk asks for. Small enough that a
// filter matching thousands of rows does not build one enormous response, big
// enough that the default limit of 500 is ten round trips rather than 500.
const DEAD_LETTER_PAGE_SIZE = 50;

const nextCursor = (page) =>
  page.pagination?.hasNextPage ? (page.pagination.endCursor ?? null) : null;

// The ids of the Caseworking dead letters a redrive-by-filter would act on,
// walked with the SAME keyset pager the list uses so the selection matches
// what the operator saw. Ids only, and all of them collected before any
// redrive runs: redriving moves a row out of DEAD_LETTER, so a cursor walk
// interleaved with redrives would silently skip rows.
//
// Deliberately does not catch, like the rest of the list path: the use case
// turns a rejection into a `sourceError` for this box.
export const findCwDeadLetterIds = async (box, options, limit) => {
  const ids = [];
  let cursor = null;

  do {
    const page = await findCwPage(box, {
      ...options,
      status: REDRIVE_FROM_STATUS,
      direction: "forward",
      pageSize: DEAD_LETTER_PAGE_SIZE,
      cursor,
    });

    ids.push(...page.data.map((row) => row._id));
    cursor = nextCursor(page);
  } while (cursor && ids.length < limit);

  return ids.slice(0, limit);
};

// ---------------------------------------------------------------------------
// Single-event reads and redrives. Unlike the list, the detail view has no
// partial mode: a Caseworking failure is a 502 with a fixed one-liner, so
// these DO catch, and translate rather than swallow.
// ---------------------------------------------------------------------------

const NOT_FOUND = 404;
const CONFLICT = 409;

const KNOWN_STATUSES = [
  "PUBLISHED",
  "PROCESSING",
  "FAILED",
  "RESUBMITTED",
  "COMPLETED",
  "DEAD_LETTER",
  "PARKED",
];

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

  return KNOWN_STATUSES.includes(status) ? status : null;
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

// A body is sent only when there is one - park has a `reason`, redrive and
// unpark have nothing to say - so an unattributed redrive is byte-identical to
// what GAS sent before this change.
const requestOptions = (body) => ({
  json: true,
  headers: { authorization: `Bearer ${config.cwBackend.token}` },
  ...(body ? { payload: body } : {}),
});

const cwRequest = async (method, path, label, options = {}) => {
  if (!isCwConfigured()) {
    throw Boom.badGateway(`Caseworking is ${notConfiguredMessage()}`);
  }

  try {
    const { payload } = await wreck[method](
      new URL(path, config.cwBackend.url).toString(),
      requestOptions(options.payload),
    );

    return payload;
  } catch (error) {
    throw toFailure(error, label, expectedOf(options));
  }
};

const expectedOf = (options) => options.expected ?? REDRIVE_FROM_STATUS;

const eventPath = (box, id) => `/actuators/${box}/${encodeURIComponent(id)}`;

const labelFor = (box, id) => `${box} event "${id}"`;

// The whole Caseworking document for one row, payload included.
export const findCwEvent = (box, id) =>
  cwRequest("get", eventPath(box, id), labelFor(box, id));

// `by` - the operator GAS read from the `x-actor` header - travels as a query
// parameter on all three mutations, so Caseworking takes the actor exactly one
// way. Omitted entirely when nobody named themselves, so an unattributed call
// is byte-identical to what GAS sent before actors existed.
const withActor = (path, by) =>
  by ? `${path}?by=${encodeURIComponent(by)}` : path;

// Answers with one Caseworking list row, already updated.
export const redriveCwEvent = (box, id, { by } = {}) =>
  cwRequest(
    "post",
    withActor(`${eventPath(box, id)}/redrive`, by),
    labelFor(box, id),
  );

// PARK - DEAD_LETTER -> PARKED, with the operator's reason. A 409 comes back
// as a 409 naming the status that blocked it, exactly as a redrive conflict does.
export const parkCwEvent = (box, id, { reason, by } = {}) =>
  cwRequest(
    "post",
    withActor(`${eventPath(box, id)}/park`, by),
    labelFor(box, id),
    {
      payload: { reason },
      expected: PARK_FROM_STATUS,
    },
  );

// UNPARK - PARKED -> DEAD_LETTER.
export const unparkCwEvent = (box, id, { by } = {}) =>
  cwRequest(
    "post",
    withActor(`${eventPath(box, id)}/unpark`, by),
    labelFor(box, id),
    {
      expected: UNPARK_FROM_STATUS,
    },
  );
