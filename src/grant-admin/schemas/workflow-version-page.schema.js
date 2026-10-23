import Joi from "joi";
import {
  counterpartSchema,
  nullableString,
  recordEventsSchema,
  recordPageSchema,
  storedBytesSchema as storedBytes,
} from "./admin-record.schema.js";
import {
  definitionFetchResultSchema,
  definitionFileSchema,
  receivedAtSchema,
  versionStatus,
  versionsSchema,
} from "./config-version.schema.js";
import { version } from "./version.js";
import { workflowCode as code } from "./workflow-code.js";

export const workflowParamsSchema = Joi.object({ code }).label(
  "WorkflowParams",
);

export const workflowVersionParamsSchema = Joi.object({ code, version }).label(
  "WorkflowVersionParams",
);

export const workflowVersionsSchema = Joi.object({
  code: Joi.string().required(),
  current: Joi.string().allow(null).required(),
  versions: versionsSchema,
}).label("WorkflowVersions");

const workflowVersionHeaderSchema = Joi.object({
  code: Joi.string().required(),
  version: Joi.string().required(),
  status: versionStatus,
  receivedAt: receivedAtSchema,
  s3Bucket: Joi.string().allow(null),
  files: Joi.object({ workflow: definitionFileSchema.required() })
    .required()
    .label("WorkflowDefinitionFiles"),
  versions: versionsSchema,
  // Read on the overview alone; null there while GAS cannot say.
  counterpart: counterpartSchema,
})
  .required()
  .label("WorkflowVersionHeader");

const roles = Joi.array().items(Joi.string()).required();

// Each fact is null while the workflow is not stored.
const overviewSchema = Joi.object({
  schemeName: nullableString,
  requiredRoles: Joi.object({ allOf: roles, anyOf: roles })
    .allow(null)
    .required()
    .label("WorkflowRequiredRoles"),
  storedBytes,
})
  .allow(null)
  .required()
  .label("WorkflowVersionOverview");

// Where one endpoint resolves to here, as Caseworking builds it from its URL setting.
const addressSchema = Joi.object({
  code: nullableString,
  service: nullableString,
  url: nullableString,
}).label("WorkflowEndpointAddress");

// Null when not stored or too large. One address per endpoint, in endpoint order.
const definitionSchema = Joi.object({
  workflow: Joi.object().unknown(true).required(),
  addresses: Joi.array().items(addressSchema).required(),
})
  .allow(null)
  .required()
  .label("WorkflowVersionDefinition");

// The stored workflow as Caseworking keeps it: never validated.
const rawSchema = Joi.object().unknown(true).allow(null).required();

const pageSchema = (tab, keys, label) =>
  recordPageSchema(workflowVersionHeaderSchema, tab, keys, label);

export const workflowVersionPageSchemas = {
  overview: pageSchema(
    "overview",
    { overview: overviewSchema },
    "WorkflowVersionOverviewPage",
  ),
  definition: pageSchema(
    "definition",
    { definition: definitionSchema },
    "WorkflowVersionDefinitionPage",
  ),
  events: pageSchema(
    "events",
    { events: recordEventsSchema("WorkflowVersionEvents") },
    "WorkflowVersionEventsPage",
  ),
  raw: pageSchema(
    "raw",
    { raw: rawSchema, storedBytes },
    "WorkflowVersionRawPage",
  ),
};

export const workflowFetchDefinitionsResponseSchema =
  definitionFetchResultSchema(["workflow"], "Workflow");
