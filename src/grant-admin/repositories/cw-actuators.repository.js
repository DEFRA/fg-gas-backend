import Boom from "@hapi/boom";
import Joi from "joi";
import { REFUSAL_REASONS, refuse } from "../../common/buckets/refusal.js";
import {
  TIMELINE_LIMIT,
  binSchema,
  catalogueEntrySchema,
  queryResponseSchema,
  summaryResponseSchema,
  timelineResponseSchema,
} from "../../common/buckets/schema.js";
import {
  EDITABLE_DESCRIPTION,
  EDIT_REFUSAL_REASONS,
} from "../../events/event-edit.js";
import {
  DEAD_LETTER,
  REDRIVABLE_DESCRIPTION,
} from "../../events/event-redrive.js";
import { eventStatusValues } from "../../events/event-status-values.js";
import {
  CLIENT_TIMEOUT,
  GATEWAY_TIMEOUT,
  NOT_FOUND,
  PAYLOAD_TOO_LARGE,
  bodyOf,
  cwRequest,
  describeError,
  operatorHeaders,
  withDocumentRetry,
} from "./cw-http.js";

const EVENT_STATUSES = new Set(eventStatusValues.map(({ value }) => value));

// Detail and redrive have no partial mode, so these catch and translate.

const CONFLICT = 409;
const PRECONDITION_FAILED = 412;
const UNPROCESSABLE = 422;

// The only values ever read from a CW error body: a known status here, and a
// known refusal reason below.
const conflictStatusOf = (error) => {
  const status = bodyOf(error)?.status;

  return EVENT_STATUSES.has(status) ? status : null;
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

const EVENT_FAILURES = {
  [NOT_FOUND]: notFound,
  [CONFLICT]: toConflict,
  [PRECONDITION_FAILED]: stale,
  [UNPROCESSABLE]: toRefusal,
  [GATEWAY_TIMEOUT]: timedOut,
  [CLIENT_TIMEOUT]: timedOut,
};

const eventPath = (box, id) =>
  `/actuators/events/${box}/${encodeURIComponent(id)}`;

const labelFor = (box, id) => `${box} event "${id}"`;

// A read never conflicts, so its `expected` is only ever a fallback wording.
export const findCwEvent = (box, id) =>
  cwRequest("get", eventPath(box, id), labelFor(box, id), {
    expected: DEAD_LETTER,
    failures: EVENT_FAILURES,
  });

const withActor = (path, by) =>
  by ? `${path}?by=${encodeURIComponent(by)}` : path;

export const redriveCwEvent = (box, id, { by } = {}) =>
  cwRequest(
    "post",
    withActor(`${eventPath(box, id)}/redrive`, by),
    labelFor(box, id),
    { expected: REDRIVABLE_DESCRIPTION, failures: EVENT_FAILURES },
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
    {
      body: purgeBody(reasonCode, note),
      expected: DEAD_LETTER,
      failures: EVENT_FAILURES,
    },
  );

// Named on the query string as purge's is: Caseworking audits the edit
// itself and refuses one that names nobody.
export const editCwPayload = (box, id, { by, payload, note, revision }) =>
  cwRequest(
    "post",
    `${eventPath(box, id)}/payload?by=${encodeURIComponent(by)}`,
    labelFor(box, id),
    {
      body: { payload, note, revision },
      expected: EDITABLE_DESCRIPTION,
      failures: EVENT_FAILURES,
    },
  );

export const CASE_NOT_FOUND = "CASE_NOT_FOUND";

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

const caseRequestOptions = ({ actor } = {}) => ({
  failures: CASE_FAILURES,
  maxBytes: CASE_MAX_BYTES,
  headers: operatorHeaders({ actor }),
});

const casePath = ({ workflowCode, caseRef }) =>
  `/actuators/cases/${encodeURIComponent(workflowCode)}/${encodeURIComponent(caseRef)}`;

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

const caseNamesSchema = Joi.object({
  phases: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().required(),
        name: Joi.string().allow(null).required(),
      }),
    )
    .required(),
  stage: Joi.string().allow(null).required(),
  status: Joi.string().allow(null).required(),
}).required();

// A Caseworking that predates names sends none, and names it cannot be sure
// of are none: the page shows the codes.
const toCaseNames = (names) => {
  const { error, value } = caseNamesSchema.validate(names, {
    stripUnknown: true,
  });

  return error ? null : value;
};

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
  names: toCaseNames(found.names),
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

export const findCwCase = withDocumentRetry(readCase);

// Only yes or no, so it names no `x-actor` and Caseworking writes no audit.
export const findCwCaseExistence = (ref) =>
  cwRequest(
    "get",
    `${casePath(ref)}/existence`,
    CASES_LABEL,
    caseRequestOptions(),
  );

const BAD_REQUEST = 400;
const BUCKETS_LABEL = "buckets";
const CW_BUCKET_PREFIX = "cw.";

export const isCwBucketId = (id) => id.startsWith(CW_BUCKET_PREFIX);

// A bucket drawn on no page of its own may name none; GAS reads it as null.
const catalogueSchema = Joi.object({
  buckets: Joi.array()
    .items(
      catalogueEntrySchema.fork(["page", "tab"], (schema) =>
        schema.optional().default(null),
      ),
    )
    .required(),
});

const bucketsUnavailable = (error) =>
  Boom.badGateway(`CW-BE buckets unavailable: ${describeError(error)}`);

const bucketsTimedOut = () => refuse("TIMED_OUT");

// The reason code is all that is read; the refusal is rebuilt from it.
const bucketRefusalOf = (error) => {
  const reason = bodyOf(error)?.reason;

  return REFUSAL_REASONS.includes(reason) ? refuse(reason) : null;
};

const bucketRefused = (error) =>
  bucketRefusalOf(error) ?? bucketsUnavailable(error);

// A 404 without a reason is a Caseworking that has no bucket routes yet.
const bucketNotFound = (error) => {
  return (
    bucketRefusalOf(error) ?? Boom.badGateway("CW-BE has no bucket routes")
  );
};

const BUCKET_FAILURES = {
  [BAD_REQUEST]: bucketRefused,
  [NOT_FOUND]: bucketNotFound,
  [GATEWAY_TIMEOUT]: bucketsTimedOut,
  [CLIENT_TIMEOUT]: bucketsTimedOut,
  otherwise: bucketsUnavailable,
};

const bucketRequestOptions = (who) => ({
  failures: BUCKET_FAILURES,
  headers: operatorHeaders(who),
});

const toCwEntries = (payload) => {
  const { error, value } = catalogueSchema.validate(payload);

  if (error) {
    throw Boom.badGateway(
      "CW-BE answered a bucket catalogue that cannot be read",
    );
  }

  return value.buckets.filter(({ id }) => isCwBucketId(id));
};

// Only the entries GAS can route: those whose id Caseworking owns.
export const findCwBuckets = async ({ timeout } = {}) =>
  toCwEntries(
    await cwRequest("get", "/actuators/buckets", BUCKETS_LABEL, {
      ...bucketRequestOptions({}),
      ...(timeout === undefined ? {} : { timeout }),
    }),
  );

const TIME_LEFT_HEADER = "x-read-time-left-ms";

const timeLeftHeader = ({ timeLeftMs }) =>
  timeLeftMs === undefined ? {} : { [TIME_LEFT_HEADER]: String(timeLeftMs) };

// Caseworking's answer is returned as it is; it audits the read itself.
// `timeout`, when given, is the time left of a read that spans several pages,
// and `timeLeftMs` how long Caseworking may read for; `signal` stops it.
export const queryCwBucket = async (bucketId, body, options = {}) => {
  const { failures, headers } = bucketRequestOptions(options);

  return cwRequest(
    "post",
    `/actuators/buckets/${encodeURIComponent(bucketId)}/query`,
    BUCKETS_LABEL,
    {
      failures,
      headers: { ...headers, ...timeLeftHeader(options) },
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      signal: options.signal,
      body,
    },
  );
};

const readBucketAnswer = (schema, payload, what) => {
  const { error, value } = schema.validate(payload);

  if (error) {
    throw Boom.badGateway(`CW-BE answered ${what} that cannot be read`);
  }

  return value;
};

export const summariseCwBucket = async (
  bucketId,
  summaryId,
  body,
  options = {},
) =>
  readBucketAnswer(
    summaryResponseSchema,
    await cwRequest(
      "post",
      `/actuators/buckets/${encodeURIComponent(bucketId)}/summaries/${encodeURIComponent(summaryId)}`,
      BUCKETS_LABEL,
      { ...bucketRequestOptions(options), body },
    ),
    "a summary",
  );

// A case's events, from Caseworking's own timeline buckets in one call.
export const readCwTimeline = async (ref, options = {}) =>
  readBucketAnswer(
    timelineResponseSchema,
    await cwRequest("post", "/actuators/timeline", BUCKETS_LABEL, {
      ...bucketRequestOptions(options),
      body: { ref },
    }),
    "a timeline",
  );

const toCwBucketTimeline = ({ bucket, rows, page }) => ({
  buckets: [{ id: bucket, label: "CW-BE", rows, more: page.next !== null }],
});

// One Caseworking bucket's page, checked as GAS reads its own.
export const readCwBucketPage = async (bucketId, body, options = {}) =>
  readBucketAnswer(
    queryResponseSchema,
    await queryCwBucket(bucketId, body, options),
    "a bucket page",
  );

// One Caseworking bucket's rows for a ref, in the shape readCwTimeline answers.
export const readCwBucketTimeline = async (bucketId, ref, options = {}) =>
  toCwBucketTimeline(
    await readCwBucketPage(bucketId, { ref, limit: TIMELINE_LIMIT }, options),
  );

const deadLettersSchema = Joi.object({
  from: Joi.string().isoDate().required(),
  to: Joi.string().isoDate().required(),
  countCap: Joi.number().integer().min(1).required(),
  buckets: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        // Caseworking sends it; GAS doesn't read it.
        list: Joi.any(),
        bins: Joi.array().items(binSchema).required(),
      }),
    )
    .min(1)
    .required(),
});

const coversWindow =
  ({ from, to, binMs }) =>
  ({ bins }) =>
    bins.length === (Date.parse(to) - Date.parse(from)) / binMs &&
    bins[0]?.from === from;

// Caseworking's dead letters in `binMs` bins over the window, one list of
// bins per bucket that holds them.
export const countCwDeadLetters = async ({ from, to, binMs }, options = {}) => {
  const answer = readBucketAnswer(
    deadLettersSchema,
    await cwRequest(
      "get",
      `/actuators/dead-letters?${new URLSearchParams({ from, to })}`,
      BUCKETS_LABEL,
      bucketRequestOptions(options),
    ),
    "dead letters",
  );

  if (!answer.buckets.every(coversWindow({ from, to, binMs }))) {
    throw Boom.badGateway("CW-BE answered bins for another window");
  }

  return answer;
};
