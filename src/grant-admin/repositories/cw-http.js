import Boom from "@hapi/boom";
import { config } from "../../common/config.js";
import { getRequestContext } from "../../common/get-request-context.js";
import { wreck } from "../../common/wreck.js";

export const NOT_FOUND = 404;
export const PAYLOAD_TOO_LARGE = 413;
export const GATEWAY_TIMEOUT = 504;
export const CLIENT_TIMEOUT = 408;
const TIMEOUT_STATUSES = new Set([GATEWAY_TIMEOUT, CLIENT_TIMEOUT]);

const READ_FAILED = "read failed";
const TIMED_OUT = "timeout";

// `new URL(path, undefined)` throws, so callers check this first.
export const isCwConfigured = () =>
  Boolean(config.cwBackend.url && config.cwBackend.token);

export const cwUrl = (path) => new URL(path, config.cwBackend.url).toString();

export const statusOf = (error) => error?.output?.statusCode ?? null;

// No connection was made, so nothing reached Caseworking.
const UNSENT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

export const isUnsent = (error) => UNSENT_CODES.has(error?.code);

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

// Caseworking records the same operator on the audit events it writes.
const actorIdHeader = () => {
  const user = getRequestContext()?.user;

  return user ? { "x-actor-id": user } : {};
};

export const requestOptions = ({ headers, ...options } = {}) => ({
  json: true,
  timeout: config.cwBackend.timeoutMs,
  ...options,
  headers: {
    authorization: `Bearer ${config.cwBackend.token}`,
    ...actorIdHeader(),
    ...headers,
  },
});

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

export const bodyOf = (error) => {
  const payload = payloadOf(error);

  return isRaw(payload) ? parseJson(payload.toString()) : payload;
};

const unavailable = (error) =>
  Boom.badGateway(`CW-BE is unavailable: ${describeError(error)}`);

// A 404 that names no reason or error code is a route Caseworking does not have.
const isBareNotFound = (error) => {
  const body = bodyOf(error) ?? {};

  return statusOf(error) === NOT_FOUND && !body.reason && !body.errorCode;
};

// Why Caseworking gave no answer, as a part of a page that shows the rest says it.
const cwReasonOf = (error) => {
  if (isUnsent(error)) {
    return "UNREACHABLE";
  }

  if (TIMEOUT_STATUSES.has(statusOf(error))) {
    return "TIMED_OUT";
  }

  return isBareNotFound(error) ? "NOT_OFFERED" : "ERRORED";
};

const toFailure = (error, label, expected, failures) =>
  Object.assign(
    (failures[statusOf(error)] ?? failures.otherwise ?? unavailable)(
      error,
      label,
      expected,
    ),
    { cwReason: cwReasonOf(error) },
  );

const assertCwConfigured = () => {
  if (!isCwConfigured()) {
    throw Object.assign(Boom.badGateway("CW-BE is not configured"), {
      cwReason: "UNREACHABLE",
    });
  }
};

// `wreck` serialises an object payload as JSON and sets the content type.
const optionsWith = (body, options) =>
  body === undefined
    ? requestOptions(options)
    : { ...requestOptions(options), payload: body };

// `failures` maps a status to the error it becomes, `otherwise` any other
// status; with neither, Caseworking is unavailable. `expected` is what
// Caseworking's 409 says the row was not, and it differs per route.
export const cwRequest = async (
  method,
  path,
  label,
  { body, expected, failures, ...options },
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

// Only the keys GAS knows are passed on, and a stored row only with its hash
// masked, so no hash Caseworking sends reaches the admin.
export const readCwAnswer = (schema, payload, what) => {
  const { error, value } = schema.validate(payload, { stripUnknown: true });

  if (error) {
    throw Boom.badGateway(`CW-BE answered ${what} that cannot be read`);
  }

  return value;
};

// `actor` is sent as the admin encoded it; Caseworking decodes it.
export const operatorHeaders = ({ actor, repeat }) => ({
  ...(actor ? { "x-actor": actor } : {}),
  ...(repeat ? { "x-search-repeat": "1" } : {}),
});

const isDocumentTooLarge = (include, error) =>
  Boolean(include) && statusOf(error) === PAYLOAD_TOO_LARGE;

// A document over the read limit is read again without it, so the page still
// shows the record and says the document is too large.
export const withDocumentRetry =
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
