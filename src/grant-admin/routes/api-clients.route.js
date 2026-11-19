import { constants } from "node:http2";
import {
  apiClientHeadersSchema,
  apiClientParamsSchema,
  apiClientsParamsSchema,
  apiTokenParamsSchema,
  answeredApiTokensSchema,
  apiTokensResponseSchema,
  changeApiTokenExpiryPayloadSchema,
  issueApiTokenPayloadSchema,
  issuedApiTokenResponseSchema,
  issuedApiTokenWithTokensResponseSchema,
  rotateApiTokenPayloadSchema,
} from "../schemas/api-client.schema.js";
import { decodeActor } from "../services/actor-header.js";
import { callerHashOf, callerOf } from "../services/request-caller.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { changeApiTokenExpiryUseCase } from "../use-cases/change-api-token-expiry.use-case.js";
import { deleteApiTokenUseCase } from "../use-cases/delete-api-token.use-case.js";
import { issueApiTokenUseCase } from "../use-cases/issue-api-token.use-case.js";
import { revokeApiTokenUseCase } from "../use-cases/revoke-api-token.use-case.js";
import { rotateApiTokenUseCase } from "../use-cases/rotate-api-token.use-case.js";
import { listApiTokensUseCase } from "../use-cases/list-api-tokens.use-case.js";
import {
  SHELL_ALWAYS,
  SHELL_ERRORS,
  answersShell,
  shellPlugins,
} from "../services/shell-tag.js";

const LABEL = "API clients";

const validate = (params, extra = {}) => ({
  params,
  headers: apiClientHeadersSchema,
  failAction: safeFailAction(LABEL),
  ...extra,
});

const response = (schema) => ({
  schema,
  failAction: safeResponseFailAction(LABEL),
});

// The caller's hash is passed on only to mark or refuse the caller's own token.
const argsOf = (request) => ({
  ...request.params,
  caller: callerOf(request),
  callerHash: callerHashOf(request),
  actor: decodeActor(request.headers["x-actor"]),
  // As the admin encoded it: a header cannot carry a name above U+00FF.
  encodedActor: request.headers["x-actor"],
});

// A refusal is not checked by the response schema, so its list is checked
// here: one that would carry a hash is answered as unread.
const carriesUnsafeTokens = (payload) =>
  Boolean(payload?.tokens) &&
  Boolean(answeredApiTokensSchema.validate({ tokens: payload.tokens }).error);

const checkRefusedTokens = (error) => {
  if (carriesUnsafeTokens(error.output?.payload)) {
    error.output.payload.tokens = null;
  }

  return error;
};

const refusalChecked = (handler) => async (request, h) => {
  try {
    return await handler(request, h);
  } catch (error) {
    throw checkRefusedTokens(error);
  }
};

const CLIENTS = "/grant-admin/clients/{service}";
const CLIENT = `${CLIENTS}/{clientId}`;
const TOKEN = `${CLIENT}/tokens/{tokenId}`;

export const listApiTokensRoute = {
  method: "GET",
  path: CLIENTS,
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: every token of one service, each under its client's name or none, with its row as stored and the hash masked",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: validate(apiClientsParamsSchema),
    response: response(apiTokensResponseSchema),
  },
  handler: (request) => listApiTokensUseCase(argsOf(request)),
};

// The page that reveals the token is drawn from this answer alone.
const issuedOf = ({ service, token, tokens }) => ({ service, token, tokens });

const REFUSAL_BODY =
  "The body names its `code` and carries `tokens`, the service's list as GET answers it, or null when it could not be read";

const refusals = (more = {}) => ({
  "hapi-swagger": {
    responses: {
      [constants.HTTP_STATUS_BAD_REQUEST]: {
        description: `Refused, by the request or the owning service's rules. ${REFUSAL_BODY}`,
      },
      [constants.HTTP_STATUS_CONFLICT]: {
        description: `Refused by the token's state. ${REFUSAL_BODY}`,
      },
      ...more,
    },
  },
});

export const issueApiTokenRoute = {
  method: "POST",
  path: `${CLIENT}/tokens`,
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: store a new token's hash for an API client, creating the client when it has no tokens. With confirmed false, a client with active tokens is refused with HAS_ACTIVE and nothing is issued. 201 with the token and the service's tokens after it",
    tags: ["api"],
    validate: validate(apiClientParamsSchema, {
      payload: issueApiTokenPayloadSchema,
    }),
    response: response(issuedApiTokenWithTokensResponseSchema),
    plugins: {
      ...shellPlugins(SHELL_ALWAYS),
      ...refusals({
        [constants.HTTP_STATUS_CONFLICT]: {
          description: `HAS_ACTIVE with the number of active tokens in \`active\`, or another refusal by the token's state. ${REFUSAL_BODY}`,
        },
      }),
    },
  },
  handler: refusalChecked(async (request, h) =>
    h
      .response(
        issuedOf(
          await issueApiTokenUseCase({
            ...argsOf(request),
            tokenHash: request.payload.tokenHash,
            tokenHint: request.payload.tokenHint,
            expiresAt: request.payload.expiresAt,
            confirmed: request.payload.confirmed,
          }),
        ),
      )
      .code(constants.HTTP_STATUS_CREATED),
  ),
};

export const revokeApiTokenRoute = {
  method: "POST",
  path: `${TOKEN}/revoke`,
  options: {
    ...answersShell(SHELL_ERRORS),
    description:
      "Admin: revoke one active token. 409 for the token this request calls with",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema),
    plugins: { ...shellPlugins(SHELL_ERRORS), ...refusals() },
  },
  handler: refusalChecked(async (request, h) => {
    await revokeApiTokenUseCase(argsOf(request));

    return h.response().code(constants.HTTP_STATUS_NO_CONTENT);
  }),
};

export const deleteApiTokenRoute = {
  method: "DELETE",
  path: TOKEN,
  options: {
    ...answersShell(SHELL_ERRORS),
    description:
      "Admin: delete one token that can no longer call. 409 while it is active",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema),
    plugins: { ...shellPlugins(SHELL_ERRORS), ...refusals() },
  },
  handler: refusalChecked(async (request, h) => {
    await deleteApiTokenUseCase(argsOf(request));

    return h.response().code(constants.HTTP_STATUS_NO_CONTENT);
  }),
};

// Answers the token alone, not the facts its audit records.
const tokenOf = ({ service, token }) => ({ service, token });

export const changeApiTokenExpiryRoute = {
  method: "PUT",
  path: `${TOKEN}/expiry`,
  options: {
    ...answersShell(SHELL_ERRORS),
    description:
      "Admin: set when a token stops working, reviving it if revoked or expired. 400 EXPIRY_PAST for an expiry that is not later than now; 409 EXPIRY_UNCHANGED for an active token's expiry moved within the UK day it already ends on, and API_TOKEN_IN_USE for stopping the token this request calls with",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema, {
      payload: changeApiTokenExpiryPayloadSchema,
    }),
    response: response(issuedApiTokenResponseSchema),
    plugins: {
      ...shellPlugins(SHELL_ERRORS),
      ...refusals({
        [constants.HTTP_STATUS_BAD_REQUEST]: {
          description: `EXPIRY_PAST, or another refusal of the expiry. ${REFUSAL_BODY}`,
        },
        [constants.HTTP_STATUS_CONFLICT]: {
          description: `EXPIRY_UNCHANGED, API_TOKEN_IN_USE or API_TOKEN_NOT_ACTIVE. ${REFUSAL_BODY}`,
        },
      }),
    },
  },
  handler: refusalChecked(async (request) =>
    tokenOf(
      await changeApiTokenExpiryUseCase({
        ...argsOf(request),
        expiresAt: request.payload.expiresAt,
      }),
    ),
  ),
};

export const rotateApiTokenRoute = {
  method: "POST",
  path: `${TOKEN}/rotate`,
  options: {
    ...answersShell(SHELL_ALWAYS),
    description:
      "Admin: replace an active token, keeping the old one for an overlap: none, or 24h or 7d and then to 23:59:59 UK time that day. 201 with the new token and the service's tokens after it. 409 for ending the token this request calls with at once",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema, {
      payload: rotateApiTokenPayloadSchema,
    }),
    response: response(issuedApiTokenWithTokensResponseSchema),
    plugins: { ...shellPlugins(SHELL_ALWAYS), ...refusals() },
  },
  handler: refusalChecked(async (request, h) =>
    h
      .response(
        issuedOf(
          await rotateApiTokenUseCase({
            ...argsOf(request),
            tokenHash: request.payload.tokenHash,
            tokenHint: request.payload.tokenHint,
            keepOld: request.payload.keepOld,
          }),
        ),
      )
      .code(constants.HTTP_STATUS_CREATED),
  ),
};
