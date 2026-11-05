import Boom from "@hapi/boom";
import {
  apiTokensSchema,
  changedApiTokenExpirySchema,
  issuedApiTokenSchema,
  rotatedApiTokenSchema,
} from "../schemas/api-client.schema.js";
import {
  CLIENT_TIMEOUT,
  GATEWAY_TIMEOUT,
  NOT_FOUND,
  bodyOf,
  cwRequest,
  describeError,
  isUnsent,
  operatorHeaders,
  readCwAnswer,
} from "./cw-http.js";

const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const CONFLICT = 409;
const CLIENTS_LABEL = "clients";

const BAD_REQUEST_CODES = [
  "API_CLIENT_INVALID_NAME",
  "API_TOKEN_INVALID_HASH",
  "API_TOKEN_INVALID_HINT",
  "API_TOKEN_INVALID_EXPIRY",
];
const NOT_FOUND_CODES = ["API_CLIENT_NOT_FOUND", "API_TOKEN_NOT_FOUND"];
const CONFLICT_CODES = [
  "API_CLIENT_EXISTS",
  "API_TOKEN_ACTIVE",
  "API_TOKEN_NOT_ACTIVE",
  "API_TOKEN_IN_USE",
  "API_TOKEN_DUPLICATE",
];

// The errorCode is the only value read from a Caseworking refusal.
const errorCodeOf = (error, known) => {
  const errorCode = bodyOf(error)?.errorCode;

  return known.includes(errorCode) ? errorCode : null;
};

const withErrorCode = (refusal, errorCode) => {
  refusal.output.payload.errorCode = errorCode;
  return refusal;
};

// Unlike any other failure, this one certainly changed nothing.
const unreachable = () =>
  withErrorCode(
    Boom.serverUnavailable("CW-BE could not be reached"),
    "CW_UNREACHABLE",
  );

const unavailable = (error) =>
  isUnsent(error)
    ? unreachable()
    : Boom.badGateway(`CW-BE clients unavailable: ${describeError(error)}`);

// Caseworking owns its clients' rules, so its refusal of a name, hash or hint
// is passed on; a 400 without one of its codes is a request GAS got wrong.
const badRequest = (error) => {
  const errorCode = errorCodeOf(error, BAD_REQUEST_CODES);

  return errorCode
    ? withErrorCode(Boom.badRequest("CW-BE refused the request"), errorCode)
    : unavailable(error);
};

const conflict = (error) =>
  withErrorCode(
    Boom.conflict("CW-BE refused the change"),
    errorCodeOf(error, CONFLICT_CODES) ?? "UNEXPECTED_FAILURE",
  );

// A 404 without one of Caseworking's codes is a route it does not have yet.
const notFound = (error) => {
  const errorCode = errorCodeOf(error, NOT_FOUND_CODES);

  return errorCode
    ? withErrorCode(
        Boom.notFound("CW-BE has no such client or token"),
        errorCode,
      )
    : Boom.badGateway("CW-BE has no client routes");
};

const forbidden = () =>
  withErrorCode(Boom.forbidden("CW-BE refused GAS's client"), "CW_FORBIDDEN");

// No answer is not a refusal: an issue or a revoke may still have committed.
const timedOut = () =>
  Boom.gatewayTimeout("CW-BE did not answer in time for clients");

const CLIENT_FAILURES = {
  [BAD_REQUEST]: badRequest,
  [FORBIDDEN]: forbidden,
  [NOT_FOUND]: notFound,
  [CONFLICT]: conflict,
  [GATEWAY_TIMEOUT]: timedOut,
  [CLIENT_TIMEOUT]: timedOut,
  otherwise: unavailable,
};

const clientsPath = "/actuators/clients";
const clientPath = (clientId) =>
  `${clientsPath}/${encodeURIComponent(clientId)}`;
const tokensPath = (clientId) => `${clientPath(clientId)}/tokens`;

const request = (method, path, { actor, body }) =>
  cwRequest(method, path, CLIENTS_LABEL, {
    body,
    failures: CLIENT_FAILURES,
    headers: operatorHeaders({ actor }),
  });

export const findCwApiTokens = async ({ actor }) =>
  readCwAnswer(
    apiTokensSchema,
    await request("get", clientsPath, { actor }),
    "clients",
  );

export const issueCwApiToken = async (
  clientId,
  { tokenHash, tokenHint, expiresAt, newClient },
  { actor },
) =>
  readCwAnswer(
    issuedApiTokenSchema,
    await request("post", tokensPath(clientId), {
      actor,
      body: { tokenHash, tokenHint, expiresAt, newClient },
    }),
    "clients",
  );

const tokenPath = (clientId, tokenId) =>
  `${tokensPath(clientId)}/${encodeURIComponent(tokenId)}`;

export const changeCwApiTokenExpiry = async (
  clientId,
  tokenId,
  { expiresAt },
  { actor },
) =>
  readCwAnswer(
    changedApiTokenExpirySchema,
    await request("put", `${tokenPath(clientId, tokenId)}/expiry`, {
      actor,
      body: { expiresAt },
    }),
    "clients",
  );

export const rotateCwApiToken = async (
  clientId,
  tokenId,
  { tokenHash, tokenHint, keepOld },
  { actor },
) =>
  readCwAnswer(
    rotatedApiTokenSchema,
    await request("post", `${tokenPath(clientId, tokenId)}/rotate`, {
      actor,
      body: { tokenHash, tokenHint, keepOld },
    }),
    "clients",
  );

export const revokeCwApiToken = async (clientId, tokenId, { actor }) => {
  await request("post", `${tokenPath(clientId, tokenId)}/revoke`, { actor });
};

export const deleteCwApiToken = async (clientId, tokenId, { actor }) => {
  await request("delete", tokenPath(clientId, tokenId), { actor });
};
