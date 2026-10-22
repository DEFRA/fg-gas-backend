import Boom from "@hapi/boom";
import Joi from "joi";
import {
  fetchStatusSchema,
  receivedAtSchema,
  versionStatus,
} from "../schemas/config-version.schema.js";
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

// Optional: a Caseworking from before it sent each version's fetch state.
const cwVersions = Joi.array()
  .items(
    Joi.object({
      ...cwVersionEntry,
      fetchStatus: fetchStatusSchema.optional(),
      stored: Joi.boolean(),
    }),
  )
  .required();

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
    fetchError: Joi.string().allow(null),
    fetchAttempts: Joi.number().integer().min(0),
    s3Key: Joi.string().allow(null),
    s3Bucket: Joi.string().allow(null),
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
