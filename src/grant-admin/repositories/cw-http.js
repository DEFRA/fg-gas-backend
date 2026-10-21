import { config } from "../../common/config.js";
import { getRequestContext } from "../../common/get-request-context.js";

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
