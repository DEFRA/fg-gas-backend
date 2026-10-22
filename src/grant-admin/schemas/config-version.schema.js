import Joi from "joi";
import { FetchStatus } from "../../common/fetch-status.js";

export const versionStatus = Joi.string().valid("active", "draft").required();

export const receivedAtSchema = Joi.string().isoDate().required();

export const fetchStatusSchema = Joi.string()
  .valid(...Object.values(FetchStatus))
  .required();

const configVersionSchema = Joi.object({
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: receivedAtSchema,
}).label("ConfigVersion");

// Newest first.
export const versionsSchema = Joi.array().items(configVersionSchema).required();

export const definitionFileSchema = Joi.object({
  stored: Joi.boolean().required(),
  fetchStatus: fetchStatusSchema,
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
