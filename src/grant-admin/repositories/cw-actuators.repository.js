import { config } from "../../common/config.js";
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

const buildUrl = (box, { cursor, direction, status, pageSize }) => {
  const url = new URL(`/actuators/${box}`, config.cwBackend.url);

  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("direction", direction);

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  if (status) {
    url.searchParams.set("status", status);
  }

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
