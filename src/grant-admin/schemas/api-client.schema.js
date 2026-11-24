import Joi from "joi";
import {
  HASH_RUN,
  isMaskedTokenRow,
} from "../../auth/services/api-client.service.js";
import { OBJECT_ID_HEX } from "../../common/object-id-hex.js";
import { decodeActor } from "../services/actor-header.js";
import { TOKENS_WITHIN_DAYS } from "../services/token-expiry.js";
import { adminReadHeadersSchema } from "./actor-header.schema.js";

export const API_CLIENT_SERVICES = ["gas", "cw"];

const service = Joi.string()
  .valid(...API_CLIENT_SERVICES)
  .required();

const tokenId = Joi.string()
  .pattern(OBJECT_ID_HEX)
  .description("24-character hex Mongo _id");

// Its rule is the owning service's, which refuses a name with
// API_CLIENT_INVALID_NAME and audits it; this only keeps the name within the
// audit's limit on an entity id.
const AUDIT_ENTITY_ID_MAX = 120;
const clientId = Joi.string().max(AUDIT_ENTITY_ID_MAX).required();

const assertNoHashRun = (value, helpers) =>
  HASH_RUN.test(decodeActor(value)) ? helpers.error("actor.hashLike") : value;

// A token row stores the name, and the list refuses any row holding what
// reads as a hash, so a name that does is refused before it is stored.
export const apiClientHeadersSchema = adminReadHeadersSchema
  .keys({
    "x-actor": adminReadHeadersSchema
      .extract("x-actor")
      .custom(assertNoHashRun)
      .messages({
        "actor.hashLike": '"x-actor" must not hold 64 hex characters in a row',
      }),
  })
  .label("ApiClientHeaders");

export const apiClientsParamsSchema = Joi.object({ service }).label(
  "ApiClientsParams",
);

export const apiClientParamsSchema = Joi.object({ service, clientId }).label(
  "ApiClientParams",
);

export const apiTokenParamsSchema = Joi.object({
  service,
  clientId,
  tokenId: tokenId.required(),
}).label("ApiTokenParams");

// The hash's, the hint's and the expiry's rules are the owning service's too,
// so a refusal is audited and never quotes the hash or the hint.
const tokenHash = Joi.string().required();
const tokenHint = Joi.string().required();
// Null is never. Any other string is passed on, for the owning service to
// refuse with API_TOKEN_INVALID_EXPIRY and audit.
const expiresAt = Joi.alternatives().try(
  Joi.date().iso(),
  Joi.string(),
  Joi.valid(null),
);

export const issueApiTokenPayloadSchema = Joi.object({
  tokenHash,
  tokenHint,
  expiresAt: expiresAt.default(null),
  confirmed: Joi.boolean()
    .strict()
    .default(true)
    .description(
      "false: refuse with HAS_ACTIVE, issuing nothing, when the client has active tokens",
    ),
  newClient: Joi.boolean()
    .strict()
    .description(
      "Ignored: the owning service decides whether the client is new",
    ),
}).label("IssueApiTokenPayload");

export const changeApiTokenExpiryPayloadSchema = Joi.object({
  expiresAt: expiresAt.required(),
}).label("ChangeApiTokenExpiryPayload");

export const KEEP_OLD_VALUES = ["none", "24h", "7d"];

export const rotateApiTokenPayloadSchema = Joi.object({
  tokenHash,
  tokenHint,
  keepOld: Joi.string()
    .valid(...KEEP_OLD_VALUES)
    .required(),
}).label("RotateApiTokenPayload");

const nullableDate = Joi.date().allow(null).required();
const nullableString = Joi.string().allow(null).required();

// A nameless row, or one named outside the name rule, has a null clientId.
export const apiTokenSchema = Joi.object({
  tokenId: tokenId.required(),
  clientId: nullableString,
  status: Joi.string().valid("ACTIVE", "EXPIRED", "REVOKED").required(),
  tokenHint: nullableString,
  createdAt: nullableDate,
  createdBy: nullableString,
  expiresAt: nullableDate,
  revokedAt: nullableDate,
  revokedBy: nullableString,
  inUse: Joi.boolean().required(),
}).label("ApiToken");

const isMaskedRowText = (text) => {
  const buf = Buffer.from(text, "base64");

  return buf.toString("base64") === text && isMaskedTokenRow(buf);
};

// The row as stored, as base64 of its own BSON, passed only as
// isMaskedTokenRow allows: a response that would carry a whole hash fails
// instead, and its refusal never names a field, as a key could be the hash.
const storedApiTokenSchema = Joi.string()
  .custom((text, helpers) =>
    isMaskedRowText(text) ? text : helpers.error("any.invalid"),
  )
  .description(
    "The row as stored, base64 BSON: flat, `id` the hash's first and last 3 characters",
  )
  .label("StoredApiToken");

const listedApiTokenSchema = apiTokenSchema
  .keys({ document: storedApiTokenSchema.required() })
  .label("ListedApiToken");

export const apiTokensSchema = Joi.object({
  tokens: Joi.array().items(listedApiTokenSchema).required(),
});

const answeredApiTokenSchema = listedApiTokenSchema
  .keys({
    expiringSoon: Joi.boolean()
      .required()
      .description(
        `Active with less than ${TOKENS_WITHIN_DAYS} days left: the Overview's rule`,
      ),
  })
  .label("AnsweredApiToken");

export const answeredApiTokensSchema = Joi.object({
  tokens: Joi.array().items(answeredApiTokenSchema).required(),
});

export const issuedApiTokenSchema = Joi.object({
  token: apiTokenSchema.required(),
});

// Caseworking answers whether the issue created the client, for the audit.
export const cwIssuedApiTokenSchema = issuedApiTokenSchema.keys({
  newClient: Joi.boolean(),
});

// What the owning service replaced, for the audit; the admin is answered the
// token alone.
export const changedApiTokenExpirySchema = issuedApiTokenSchema.keys({
  previousExpiresAt: nullableDate,
  revived: Joi.boolean().required(),
});

export const rotatedApiTokenSchema = issuedApiTokenSchema.keys({
  oldExpiresAt: Joi.date().required(),
});

const withService = (schema, label) => schema.keys({ service }).label(label);

export const apiTokensResponseSchema = withService(
  answeredApiTokensSchema,
  "ApiTokensResponse",
);

export const issuedApiTokenResponseSchema = withService(
  issuedApiTokenSchema,
  "IssuedApiTokenResponse",
);

// The list the page is drawn again from, null when it could not be read.
const tokensAfter = Joi.array()
  .items(answeredApiTokenSchema)
  .allow(null)
  .required();

export const issuedApiTokenWithTokensResponseSchema = withService(
  issuedApiTokenSchema.keys({ tokens: tokensAfter }),
  "IssuedApiTokenWithTokensResponse",
);
