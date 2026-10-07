import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { getRequestContext } from "../../common/get-request-context.js";
import { logger } from "../../common/logger.js";
import { wreck } from "../../common/wreck.js";
import {
  EDITABLE_DESCRIPTION,
  EDIT_REFUSAL_REASONS,
} from "../../events/event-edit.js";
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

// Caseworking records the same operator on the audit events it writes.
const actorIdHeader = () => {
  const user = getRequestContext()?.user;

  return user ? { "x-actor-id": user } : {};
};

const requestOptions = ({ headers, ...options } = {}) => ({
  json: true,
  timeout: config.cwBackend.timeoutMs,
  ...options,
  headers: {
    authorization: `Bearer ${config.cwBackend.token}`,
    ...actorIdHeader(),
    ...headers,
  },
});

// A shorter timeout, so a slow Caseworking degrades the page rather than stalls it.
export const findCwPage = async (options) => {
  const { payload } = await wreck.get(buildPageUrl(options), requestOptions());

  const body = payload ?? {};

  return {
    inbox: toBoxSection(body.inbox),
    outbox: toBoxSection(body.outbox),
  };
};

// Detail and redrive have no partial mode, so these catch and translate.

const NOT_FOUND = 404;
const CONFLICT = 409;
const PRECONDITION_FAILED = 412;
const UNPROCESSABLE = 422;

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

// The only values ever read from a CW error body: a known status here, and a
// known refusal reason below.
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

const refusalReasonOf = (error) => {
  const reason = bodyOf(error)?.reason;

  return Object.values(EDIT_REFUSAL_REASONS).includes(reason) ? reason : null;
};

const toRefusal = (error, label) => {
  const refusal = Boom.badData(`CW-BE refused the payload of ${label}`);

  refusal.output.payload.reason = refusalReasonOf(error);

  return refusal;
};

const notFound = (_, label) => Boom.notFound(`CW-BE ${label} not found`);

const stale = (_, label) =>
  Boom.preconditionFailed(`CW-BE ${label} was edited since the revision given`);

// No answer is not a refusal: a redrive may still have committed.
const timedOut = (_, label) =>
  Boom.gatewayTimeout(`CW-BE did not answer in time for ${label}`);

const FAILURES = {
  [NOT_FOUND]: notFound,
  [CONFLICT]: toConflict,
  [PRECONDITION_FAILED]: stale,
  [UNPROCESSABLE]: toRefusal,
  [GATEWAY_TIMEOUT]: timedOut,
  [CLIENT_TIMEOUT]: timedOut,
};

const unavailable = (error) =>
  Boom.badGateway(`CW-BE is unavailable: ${describeError(error)}`);

const toFailure = (error, label, expected, failures) =>
  (failures[statusOf(error)] ?? failures.otherwise ?? unavailable)(
    error,
    label,
    expected,
  );

const assertCwConfigured = () => {
  if (!isCwConfigured()) {
    throw Boom.badGateway("CW-BE is not configured");
  }
};

// `wreck` serialises an object payload as JSON and sets the content type.
const optionsWith = (body, options) =>
  body === undefined
    ? requestOptions(options)
    : { ...requestOptions(options), payload: body };

// `expected` is what Caseworking's 409 says the row was not, and it differs
// per route.
const cwRequest = async (
  method,
  path,
  label,
  { body, expected, failures = FAILURES, ...options } = {},
) => {
  assertCwConfigured();

  try {
    const { payload } = await wreck[method](
      new URL(path, config.cwBackend.url).toString(),
      optionsWith(body, options),
    );

    return payload;
  } catch (error) {
    throw toFailure(error, label, expected, failures);
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

// Named on the query string as purge's is: Caseworking audits the edit
// itself and refuses one that names nobody.
export const editCwPayload = (box, id, { by, payload, note, revision }) =>
  cwRequest(
    "post",
    `${eventPath(box, id)}/payload?by=${encodeURIComponent(by)}`,
    labelFor(box, id),
    { body: { payload, note, revision }, expected: EDITABLE_DESCRIPTION },
  );

export const CASE_NOT_FOUND = "CASE_NOT_FOUND";

const BAD_REQUEST = 400;
const PAYLOAD_TOO_LARGE = 413;
const CASE_MAX_BYTES = 4 * 1024 * 1024;
const CASES_LABEL = "cases";

const caseNotFound = () => {
  const error = Boom.notFound("case not found");

  error.output.payload.reason = CASE_NOT_FOUND;

  return error;
};

// A 404 without Caseworking's reason is a route it does not have yet.
const notFoundOrMissingRoute = (error) =>
  bodyOf(error)?.reason === CASE_NOT_FOUND
    ? caseNotFound()
    : Boom.badGateway("CW-BE has no cases route");

const caseTooLarge = () =>
  Boom.entityTooLarge("CW-BE case is over the read limit");

const caseUnavailable = (error) =>
  Boom.badGateway(`CW-BE cases unavailable: ${describeError(error)}`);

const caseTimedOut = () =>
  Boom.gatewayTimeout("CW-BE cases did not answer in time");

const CASE_FAILURES = {
  [NOT_FOUND]: notFoundOrMissingRoute,
  [PAYLOAD_TOO_LARGE]: caseTooLarge,
  [GATEWAY_TIMEOUT]: caseTimedOut,
  [CLIENT_TIMEOUT]: caseTimedOut,
  otherwise: caseUnavailable,
};

const caseQueryRefused = () => Boom.badRequest("CW-BE refused the case query");

const casesNotLoaded = (error) => {
  logger.warn(
    `Search cases: caseworking unavailable (${describeError(error)})`,
  );

  return Boom.badGateway("Cases could not be loaded from Caseworking");
};

// The list has no other source, so Caseworking being down is the call
// failing. A query it refused, such as a stale cursor, is still a 400.
const SEARCH_FAILURES = {
  [BAD_REQUEST]: caseQueryRefused,
  otherwise: casesNotLoaded,
};

// `actor` is sent as the admin encoded it; Caseworking decodes it.
const caseRequestOptions = ({ actor, repeat } = {}) => ({
  failures: CASE_FAILURES,
  maxBytes: CASE_MAX_BYTES,
  headers: {
    ...(actor ? { "x-actor": actor } : {}),
    ...(repeat ? { "x-search-repeat": "1" } : {}),
  },
});

const casePath = ({ workflowCode, caseRef }) =>
  `/actuators/cases/${encodeURIComponent(workflowCode)}/${encodeURIComponent(caseRef)}`;

const toCaseRow = ({
  ref,
  position,
  closed,
  closedAt,
  createdAt,
  replaced,
}) => ({
  ref: { caseRef: ref.caseRef, workflowCode: ref.workflowCode },
  position,
  closed,
  closedAt,
  createdAt,
  ...(replaced === undefined ? {} : { replaced }),
});

const toCasePage = ({ cases, pagination, total, workflowCodes }) => ({
  rows: cases.map(toCaseRow),
  pagination,
  ...(total ? { total } : {}),
  ...(workflowCodes ? { workflowCodes } : {}),
});

export const searchCwCases = async (query, { actor, repeat } = {}) =>
  toCasePage(
    await cwRequest("post", "/actuators/cases/search", CASES_LABEL, {
      ...caseRequestOptions({ actor, repeat }),
      failures: SEARCH_FAILURES,
      body: query,
    }),
  );

const toSeriesMember = ({ caseRef, position, createdAt, closedAt }) => ({
  caseRef,
  position,
  createdAt,
  closedAt,
});

// A Caseworking that predates series members sends none.
const toCaseSeries = ({ latestRef, refs, members }) => ({
  latestRef,
  refs,
  ...(members === undefined ? {} : { members: members.map(toSeriesMember) }),
});

const toCaseSummary = (found) => ({
  caseRef: found.ref.caseRef,
  workflowCode: found.ref.workflowCode,
  position: found.position,
  closed: found.closed,
  closedAt: found.closedAt,
  createdAt: found.createdAt,
  originalConfigVersion: found.originalConfigVersion,
  currentConfigVersion: found.currentConfigVersion,
  series: found.series && toCaseSeries(found.series),
});

const readCase = async (ref, { include, actor }) => {
  const query = include ? `?include=${encodeURIComponent(include)}` : "";
  const answer = await cwRequest(
    "get",
    `${casePath(ref)}${query}`,
    CASES_LABEL,
    caseRequestOptions({ actor }),
  );

  return {
    summary: toCaseSummary(answer.case),
    storedBytes: answer.storedBytes,
    document: answer.document ?? null,
  };
};

const isDocumentTooLarge = (include, error) =>
  Boolean(include) && statusOf(error) === PAYLOAD_TOO_LARGE;

// A document over the read limit is read again without it, so the page still
// shows the case and says the document is too large.
export const findCwCase = async (ref, { include, actor }) => {
  try {
    return await readCase(ref, { include, actor });
  } catch (error) {
    if (!isDocumentTooLarge(include, error)) {
      throw error;
    }

    return { ...(await readCase(ref, { actor })), tooLarge: true };
  }
};

// Only yes or no, so it names no `x-actor` and Caseworking writes no audit.
export const findCwCaseExistence = (ref) =>
  cwRequest(
    "get",
    `${casePath(ref)}/existence`,
    CASES_LABEL,
    caseRequestOptions(),
  );
