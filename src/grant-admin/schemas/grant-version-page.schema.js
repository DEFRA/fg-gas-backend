import Joi from "joi";
import {
  nullableIso,
  nullableString,
  recordPageSchema,
  storedBytesSchema as storedBytes,
} from "./admin-record.schema.js";
import { code } from "./code.js";
import {
  definitionFetchResultSchema,
  definitionFileSchema,
  receivedAtSchema,
  versionStatus,
  versionsSchema,
} from "./config-version.schema.js";
import { version } from "./version.js";

export const grantParamsSchema = Joi.object({ code }).label("GrantParams");

export const grantVersionParamsSchema = Joi.object({ code, version }).label(
  "GrantVersionParams",
);

export const grantVersionsSchema = Joi.object({
  code: Joi.string().required(),
  current: Joi.string().allow(null).required(),
  versions: versionsSchema,
}).label("GrantVersions");

// A file the version has no location for is absent, never null.
const grantVersionHeaderSchema = Joi.object({
  code: Joi.string().required(),
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: receivedAtSchema,
  files: Joi.object({
    grant: definitionFileSchema.required(),
    agreement: definitionFileSchema,
    payment: definitionFileSchema,
  })
    .required()
    .label("DefinitionFiles"),
  versions: versionsSchema,
})
  .required()
  .label("GrantVersionHeader");

// Null when the read failed; each fact is null while the grant file is not stored.
const overviewSchema = Joi.object({
  description: nullableString,
  startDate: nullableIso,
  adminRole: nullableString,
  storedBytes,
})
  .allow(null)
  .required()
  .label("GrantVersionOverview");

// The stored grant document as stored: null when not stored or too large.
const definitionSchema = Joi.object().unknown(true).allow(null).required();

const pageSchema = (tab, keys, label) =>
  recordPageSchema(grantVersionHeaderSchema, tab, keys, label);

export const grantVersionPageSchemas = {
  overview: pageSchema(
    "overview",
    { overview: overviewSchema },
    "GrantVersionOverviewPage",
  ),
  definition: pageSchema(
    "definition",
    { definition: definitionSchema },
    "GrantVersionDefinitionPage",
  ),
};

export const fetchDefinitionsResponseSchema = definitionFetchResultSchema(
  ["grant", "agreement", "payment"],
  "Grant",
);
