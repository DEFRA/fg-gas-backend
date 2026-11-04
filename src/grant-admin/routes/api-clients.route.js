import { constants } from "node:http2";
import {
  apiClientHeadersSchema,
  apiClientParamsSchema,
  apiClientsParamsSchema,
  apiTokenParamsSchema,
  apiTokensResponseSchema,
  changeApiTokenExpiryPayloadSchema,
  issueApiTokenPayloadSchema,
  issuedApiTokenResponseSchema,
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

const CLIENTS = "/grant-admin/clients/{service}";
const CLIENT = `${CLIENTS}/{clientId}`;
const TOKEN = `${CLIENT}/tokens/{tokenId}`;

export const listApiTokensRoute = {
  method: "GET",
  path: CLIENTS,
  options: {
    description:
      "Admin: every token of one service, each under its client's name or none, with its row as stored and the hash masked",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: validate(apiClientsParamsSchema),
    response: response(apiTokensResponseSchema),
  },
  handler: (request) => listApiTokensUseCase(argsOf(request)),
};

export const issueApiTokenRoute = {
  method: "POST",
  path: `${CLIENT}/tokens`,
  options: {
    description:
      "Admin: store a new token's hash for an API client, creating the client when newClient is set",
    tags: ["api"],
    validate: validate(apiClientParamsSchema, {
      payload: issueApiTokenPayloadSchema,
    }),
    response: response(issuedApiTokenResponseSchema),
  },
  handler: async (request, h) =>
    h
      .response(
        await issueApiTokenUseCase({
          ...argsOf(request),
          tokenHash: request.payload.tokenHash,
          tokenHint: request.payload.tokenHint,
          expiresAt: request.payload.expiresAt,
          newClient: request.payload.newClient,
        }),
      )
      .code(constants.HTTP_STATUS_CREATED),
};

export const revokeApiTokenRoute = {
  method: "POST",
  path: `${TOKEN}/revoke`,
  options: {
    description:
      "Admin: revoke one active token. 409 for the token this request calls with",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema),
  },
  handler: async (request, h) => {
    await revokeApiTokenUseCase(argsOf(request));

    return h.response().code(constants.HTTP_STATUS_NO_CONTENT);
  },
};

export const deleteApiTokenRoute = {
  method: "DELETE",
  path: TOKEN,
  options: {
    description:
      "Admin: delete one token that can no longer call. 409 while it is active",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema),
  },
  handler: async (request, h) => {
    await deleteApiTokenUseCase(argsOf(request));

    return h.response().code(constants.HTTP_STATUS_NO_CONTENT);
  },
};

// Answers the token alone, not the facts its audit records.
const tokenOf = ({ service, token }) => ({ service, token });

export const changeApiTokenExpiryRoute = {
  method: "PUT",
  path: `${TOKEN}/expiry`,
  options: {
    description:
      "Admin: set when a token stops working, reviving it if revoked. 409 for stopping the token this request calls with",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema, {
      payload: changeApiTokenExpiryPayloadSchema,
    }),
    response: response(issuedApiTokenResponseSchema),
  },
  handler: async (request) =>
    tokenOf(
      await changeApiTokenExpiryUseCase({
        ...argsOf(request),
        expiresAt: request.payload.expiresAt,
      }),
    ),
};

export const rotateApiTokenRoute = {
  method: "POST",
  path: `${TOKEN}/rotate`,
  options: {
    description:
      "Admin: replace an active token, keeping the old one for an overlap: none, or 24h or 7d and then to 23:59:59 UK time that day. 409 for ending the token this request calls with at once",
    tags: ["api"],
    validate: validate(apiTokenParamsSchema, {
      payload: rotateApiTokenPayloadSchema,
    }),
    response: response(issuedApiTokenResponseSchema),
  },
  handler: async (request, h) =>
    h
      .response(
        tokenOf(
          await rotateApiTokenUseCase({
            ...argsOf(request),
            tokenHash: request.payload.tokenHash,
            tokenHint: request.payload.tokenHint,
            keepOld: request.payload.keepOld,
          }),
        ),
      )
      .code(constants.HTTP_STATUS_CREATED),
};
