import Joi from "joi";
import { FetchStatus } from "../../common/fetch-status.js";
import {
  nullableIso,
  nullableString,
  recordPageSchema,
  storedBytesSchema as storedBytes,
} from "./admin-record.schema.js";
import { code } from "./code.js";
import { version } from "./version.js";

export const grantParamsSchema = Joi.object({ code }).label("GrantParams");

export const grantVersionParamsSchema = Joi.object({ code, version }).label(
  "GrantVersionParams",
);

const versionStatus = Joi.string().valid("active", "draft").required();

const grantVersionSchema = Joi.object({
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: Joi.string().isoDate().required(),
}).label("GrantVersion");

// Newest first.
const versionsSchema = Joi.array().items(grantVersionSchema).required();

export const grantVersionsSchema = Joi.object({
  code: Joi.string().required(),
  current: Joi.string().allow(null).required(),
  versions: versionsSchema,
}).label("GrantVersions");

const definitionFileSchema = Joi.object({
  stored: Joi.boolean().required(),
  fetchStatus: Joi.string()
    .valid(...Object.values(FetchStatus))
    .required(),
}).label("DefinitionFile");

// A file the version has no location for is absent, never null.
const grantVersionHeaderSchema = Joi.object({
  code: Joi.string().required(),
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: Joi.string().isoDate().required(),
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

const fetchedFileSchema = Joi.object({
  file: Joi.string().valid("grant", "agreement", "payment").required(),
  outcome: Joi.string().valid("stored").required(),
}).label("FetchedDefinitionFile");

const notFetchedFileSchema = Joi.object({
  file: Joi.string().valid("grant", "agreement", "payment").required(),
  outcome: Joi.string().valid("failed").required(),
  reason: Joi.string()
    .valid("missing", "forbidden", "timeout", "unparseable", "invalid")
    .required(),
  // GAS's own words, set only when the owning context refused the file.
  message: Joi.string().allow(null).required(),
}).label("NotFetchedDefinitionFile");

// Only the files that were not stored when the fetch began, in the order tried.
export const fetchDefinitionsResponseSchema = Joi.object({
  files: Joi.array().items(fetchedFileSchema, notFetchedFileSchema).required(),
}).label("FetchDefinitionsResult");
