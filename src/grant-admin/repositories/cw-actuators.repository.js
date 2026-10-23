import Boom from "@hapi/boom";
import Joi from "joi";
import { REFUSAL_REASONS, refuse } from "../../common/buckets/refusal.js";
import {
  TIMELINE_LIMIT,
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

const catalogueSchema = Joi.object({
  buckets: Joi.array().items(catalogueEntrySchema).required(),
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
const bucketNotFound = (error) =>
  bucketRefusalOf(error) ?? Boom.badGateway("CW-BE has no bucket routes");

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

  return value.buckets.filter(({ id }) => id.startsWith(CW_BUCKET_PREFIX));
};

// Only the entries GAS can route: those whose id Caseworking owns.
export const findCwBuckets = async () =>
  toCwEntries(
    await cwRequest(
      "get",
      "/actuators/buckets",
      BUCKETS_LABEL,
      bucketRequestOptions({}),
    ),
  );

// Caseworking's answer is returned as it is; it audits the read itself.
export const queryCwBucket = async (bucketId, body, options = {}) =>
  cwRequest(
    "post",
    `/actuators/buckets/${encodeURIComponent(bucketId)}/query`,
    BUCKETS_LABEL,
    { ...bucketRequestOptions(options), body },
  );

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

// One Caseworking bucket's rows for a ref, in the shape readCwTimeline answers.
export const readCwBucketTimeline = async (bucketId, ref, options = {}) =>
  toCwBucketTimeline(
    readBucketAnswer(
      queryResponseSchema,
      await queryCwBucket(bucketId, { ref, limit: TIMELINE_LIMIT }, options),
      "a bucket page",
    ),
  );
