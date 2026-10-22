import Joi from "joi";
import { FetchStatus } from "../../common/fetch-status.js";

export const versionStatus = Joi.string().valid("active", "draft").required();

export const receivedAtSchema = Joi.string().isoDate().required();

export const fetchStatusSchema = Joi.string()
  .valid(...Object.values(FetchStatus))
  .required();

// `fetchStatus` is the version's worst, null until it is stamped with one;
// `stored` is whether every file it has is stored. Both are absent from a
// Caseworking that does not send them.
const configVersionSchema = Joi.object({
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: receivedAtSchema,
  fetchStatus: fetchStatusSchema.optional().allow(null),
  stored: Joi.boolean(),
}).label("ConfigVersion");

// Newest first.
export const versionsSchema = Joi.array().items(configVersionSchema).required();

// The fetch details are absent from a Caseworking that does not send them.
export const definitionFileSchema = Joi.object({
  stored: Joi.boolean().required(),
  fetchStatus: fetchStatusSchema,
  fetchError: Joi.string().allow(null),
  fetchAttempts: Joi.number().integer().min(0),
  s3Key: Joi.string().allow(null),
}).label("DefinitionFile");

const fetchedFileSchema = (files, kind) =>
  Joi.object({
    file: Joi.string()
      .valid(...files)
      .required(),
    outcome: Joi.string().valid("stored").required(),
  }).label(`Fetched${kind}DefinitionFile`);

const notFetchedFileSchema = (files, kind) =>
  Joi.object({
    file: Joi.string()
      .valid(...files)
      .required(),
    outcome: Joi.string().valid("failed").required(),
    reason: Joi.string()
      .valid("missing", "forbidden", "timeout", "unparseable", "invalid")
      .required(),
    // The owning service's own words, set only when it refused the file.
    message: Joi.string().allow(null).required(),
  }).label(`NotFetched${kind}DefinitionFile`);

// Only the files that were not stored when the fetch began, in the order tried.
export const definitionFetchResultSchema = (files, kind) =>
  Joi.object({
    files: Joi.array()
      .items(fetchedFileSchema(files, kind), notFetchedFileSchema(files, kind))
      .required(),
  }).label(`${kind}FetchDefinitionsResult`);
