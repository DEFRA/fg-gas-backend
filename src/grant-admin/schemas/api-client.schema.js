import Joi from "joi";
import {
  HASH_RUN,
  MASKED_HASH,
} from "../../auth/services/api-client.service.js";
import { OBJECT_ID_HEX } from "../../common/object-id-hex.js";
import { decodeActor } from "../services/actor-header.js";
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
  newClient: Joi.boolean().strict().default(false),
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

const objectId = Joi.object({ $oid: tokenId.required() });

// No key or value but `id` holds a hash, and `id` holds only a masked one, so
// a response that would carry a whole hash fails instead.
const storedValue = Joi.alternatives().try(
  Joi.string().allow("").pattern(HASH_RUN, { invert: true }),
  Joi.number(),
  Joi.boolean(),
  Joi.valid(null),
  objectId,
  Joi.object({ $date: Joi.string().isoDate().required() }),
);

const isStoredField = ([key, value]) =>
  !HASH_RUN.test(key) && !storedValue.validate(value).error;

// The row as stored, in relaxed Extended JSON, every field it has, kept as
// sent. Its other fields are checked as a whole, so a refusal's path never
// names one: a key could be the hash.
const storedApiTokenSchema = Joi.object({
  _id: objectId.required(),
  id: Joi.string().pattern(MASKED_HASH).required(),
})
  .unknown(true)
  .custom((row, helpers) =>
    Object.entries(row).every(isStoredField)
      ? row
      : helpers.error("any.invalid"),
  )
  .label("StoredApiToken");

const listedApiTokenSchema = apiTokenSchema
  .keys({ stored: storedApiTokenSchema.required() })
  .label("ListedApiToken");

export const apiTokensSchema = Joi.object({
  tokens: Joi.array().items(listedApiTokenSchema).required(),
});

export const issuedApiTokenSchema = Joi.object({
  token: apiTokenSchema.required(),
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
  apiTokensSchema,
  "ApiTokensResponse",
);

export const issuedApiTokenResponseSchema = withService(
  issuedApiTokenSchema,
  "IssuedApiTokenResponse",
);
