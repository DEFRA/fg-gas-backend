import Boom from "@hapi/boom";
import Joi from "joi";
import { REFUSAL_REASONS, refuse } from "../../common/buckets/refusal.js";
import {
  catalogueEntrySchema,
  summaryResponseSchema,
  timelineResponseSchema,
} from "../../common/buckets/schema.js";
import { wreck } from "../../common/wreck.js";
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
  fetchStatusSchema,
  receivedAtSchema,
  versionStatus,
} from "../schemas/config-version.schema.js";
import {
  CLIENT_TIMEOUT,
  GATEWAY_TIMEOUT,
  cwUrl,
  describeError,
  isCwConfigured,
  requestOptions,
  statusOf,
} from "./cw-http.js";

export { describeError, isCwConfigured };

const EVENT_STATUSES = new Set(eventStatusValues.map(({ value }) => value));

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
      cwUrl(path),
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

// `actor` is sent as the admin encoded it; Caseworking decodes it.
const operatorHeaders = ({ actor, repeat }) => ({
  ...(actor ? { "x-actor": actor } : {}),
  ...(repeat ? { "x-search-repeat": "1" } : {}),
});

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

const isDocumentTooLarge = (include, error) =>
  Boolean(include) && statusOf(error) === PAYLOAD_TOO_LARGE;

// A document over the read limit is read again without it, so the page still
// shows the record and says the document is too large.
const withDocumentRetry =
  (read) =>
  async (ref, { include, actor }) => {
    try {
      return await read(ref, { include, actor });
    } catch (error) {
      if (!isDocumentTooLarge(include, error)) {
        throw error;
      }

      return { ...(await read(ref, { actor })), tooLarge: true };
    }
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

export const WORKFLOW_NOT_FOUND = "WORKFLOW_NOT_FOUND";
export const WORKFLOW_VERSION_NOT_FOUND = "WORKFLOW_VERSION_NOT_FOUND";

const WORKFLOW_MAX_BYTES = 4 * 1024 * 1024;
const WORKFLOWS_LABEL = "workflows";

const WORKFLOW_REASONS = {
  [WORKFLOW_NOT_FOUND]: "workflow not found",
  [WORKFLOW_VERSION_NOT_FOUND]: "workflow version not found",
};

// A 404 without one of Caseworking's reasons is a route it does not have yet.
const workflowNotFound = (error) => {
  const reason = bodyOf(error)?.reason;

  if (!Object.hasOwn(WORKFLOW_REASONS, reason ?? "")) {
    return Boom.badGateway("CW-BE has no workflow routes");
  }

  const refusal = Boom.notFound(WORKFLOW_REASONS[reason]);

  refusal.output.payload.reason = reason;

  return refusal;
};

const workflowTooLarge = () =>
  Boom.entityTooLarge("CW-BE workflow is over the read limit");

const workflowsUnavailable = (error) =>
  Boom.badGateway(`CW-BE workflows unavailable: ${describeError(error)}`);

const workflowsTimedOut = () =>
  Boom.gatewayTimeout("CW-BE workflows did not answer in time");

const WORKFLOW_FAILURES = {
  [NOT_FOUND]: workflowNotFound,
  [PAYLOAD_TOO_LARGE]: workflowTooLarge,
  [GATEWAY_TIMEOUT]: workflowsTimedOut,
  [CLIENT_TIMEOUT]: workflowsTimedOut,
  otherwise: workflowsUnavailable,
};

const workflowRequestOptions = ({ actor } = {}) => ({
  failures: WORKFLOW_FAILURES,
  maxBytes: WORKFLOW_MAX_BYTES,
  headers: operatorHeaders({ actor }),
});

const versionsPath = (code) =>
  `/actuators/workflows/${encodeURIComponent(code)}/versions`;

const versionPath = ({ code, version }) =>
  `${versionsPath(code)}/${encodeURIComponent(version)}`;

const nullableString = Joi.string().allow(null).required();

// As strict as GAS's own answer, so a row Caseworking stores wrongly is its
// fault (502), not GAS's (500).
const cwVersionEntry = {
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: receivedAtSchema,
};

const cwVersions = Joi.array().items(Joi.object(cwVersionEntry)).required();

const cwRoles = Joi.array().items(Joi.string()).required();

const cwWorkflowVersionsSchema = Joi.object({
  code: Joi.string().required(),
  current: nullableString,
  versions: cwVersions,
});

const cwWorkflowVersionSchema = Joi.object({
  version: Joi.object({
    grantCode: Joi.string().required(),
    ...cwVersionEntry,
    fetchStatus: fetchStatusSchema,
  }).required(),
  versions: cwVersions,
  current: nullableString,
  storedBytes: Joi.number().integer().min(0).allow(null).required(),
  summary: Joi.object({
    schemeName: nullableString,
    requiredRoles: Joi.object({ allOf: cwRoles, anyOf: cwRoles }).required(),
  })
    .allow(null)
    .required(),
  document: Joi.object().unknown(true).allow(null),
  addresses: Joi.array().items(
    Joi.object({
      code: nullableString,
      service: nullableString,
      url: nullableString,
    }),
  ),
});

const cwFetchedFile = Joi.object({
  file: Joi.string().valid("workflow").required(),
  outcome: Joi.string().valid("stored", "failed").required(),
  reason: Joi.when("outcome", {
    is: "failed",
    then: Joi.string()
      .valid("missing", "forbidden", "timeout", "unparseable", "invalid")
      .required(),
    otherwise: Joi.forbidden(),
  }),
  message: Joi.string(),
});

const cwFetchSchema = Joi.object({
  files: Joi.array().items(cwFetchedFile).required(),
});

// Only the keys GAS knows are passed on; the document is Caseworking's as stored.
const readWorkflowAnswer = (schema, payload, what) => {
  const { error, value } = schema.validate(payload, { stripUnknown: true });

  if (error) {
    throw Boom.badGateway(`CW-BE answered ${what} that cannot be read`);
  }

  return value;
};

export const findCwWorkflowVersions = async (code, { actor } = {}) =>
  readWorkflowAnswer(
    cwWorkflowVersionsSchema,
    await cwRequest(
      "get",
      versionsPath(code),
      WORKFLOWS_LABEL,
      workflowRequestOptions({ actor }),
    ),
    "workflow versions",
  );

const readWorkflowVersion = async (ref, { include, actor }) => {
  const query = include ? `?include=${encodeURIComponent(include)}` : "";
  const answer = readWorkflowAnswer(
    cwWorkflowVersionSchema,
    await cwRequest(
      "get",
      `${versionPath(ref)}${query}`,
      WORKFLOWS_LABEL,
      workflowRequestOptions({ actor }),
    ),
    "a workflow version",
  );

  return {
    ...answer,
    document: answer.document ?? null,
    addresses: answer.addresses ?? null,
  };
};

export const findCwWorkflowVersion = withDocumentRetry(readWorkflowVersion);

const cwExistenceSchema = Joi.object({ exists: Joi.boolean().required() });

// Only yes or no, so it names no `x-actor` and Caseworking writes no audit.
export const findCwWorkflowVersionExistence = async (ref) =>
  readWorkflowAnswer(
    cwExistenceSchema,
    await cwRequest(
      "get",
      `${versionPath(ref)}/existence`,
      WORKFLOWS_LABEL,
      workflowRequestOptions(),
    ),
    "a workflow version's existence",
  );

const toFetchedFile = ({ file, outcome, reason, message }) =>
  outcome === "stored"
    ? { file, outcome }
    : { file, outcome, reason, message: message ?? null };

// Caseworking audits the fetch itself and refuses one that names nobody.
export const fetchCwWorkflowDefinition = async (ref, { by }) => {
  const { files } = readWorkflowAnswer(
    cwFetchSchema,
    await cwRequest(
      "post",
      `${versionPath(ref)}/fetch?by=${encodeURIComponent(by)}`,
      WORKFLOWS_LABEL,
      { failures: WORKFLOW_FAILURES },
    ),
    "a workflow fetch",
  );

  return { files: files.map(toFetchedFile) };
};

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

const toCwSummary = (payload) => {
  const { error, value } = summaryResponseSchema.validate(payload);

  if (error) {
    throw Boom.badGateway("CW-BE answered a summary that cannot be read");
  }

  return value;
};

export const summariseCwBucket = async (
  bucketId,
  summaryId,
  body,
  options = {},
) =>
  toCwSummary(
    await cwRequest(
      "post",
      `/actuators/buckets/${encodeURIComponent(bucketId)}/summaries/${encodeURIComponent(summaryId)}`,
      BUCKETS_LABEL,
      { ...bucketRequestOptions(options), body },
    ),
  );

const toCwTimeline = (payload) => {
  const { error, value } = timelineResponseSchema.validate(payload);

  if (error) {
    throw Boom.badGateway("CW-BE answered a timeline that cannot be read");
  }

  return value;
};

// A case's events, from Caseworking's own timeline buckets in one call.
export const readCwTimeline = async (ref, options = {}) =>
  toCwTimeline(
    await cwRequest("post", "/actuators/timeline", BUCKETS_LABEL, {
      ...bucketRequestOptions(options),
      body: { ref },
    }),
  );
