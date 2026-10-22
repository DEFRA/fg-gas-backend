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

const codeSchema = Joi.string().allow("").required();
const nameSchema = Joi.string().allow(null).required();
// PHASE:STAGE:STATUS.
const positionSchema = Joi.string().required();
const processesSchema = Joi.array().items(Joi.string()).required();

const lifecyclePhaseSchema = Joi.object({
  code: codeSchema,
  name: nameSchema,
  stages: Joi.array()
    .items(
      Joi.object({
        code: codeSchema,
        name: nameSchema,
        statuses: Joi.array()
          .items(Joi.object({ code: codeSchema }))
          .required(),
      }).label("LifecycleStage"),
    )
    .required(),
}).label("LifecyclePhase");

// How an application reaches a position: a move from another position, a
// validFrom entry no position matches, or from any status.
const wayInSchema = Joi.object({
  to: positionSchema,
  kind: Joi.string().valid("move", "unmatched", "any").required(),
  from: positionSchema.when("kind", {
    is: "move",
    otherwise: Joi.forbidden(),
  }),
  code: codeSchema.when("kind", {
    is: "unmatched",
    otherwise: Joi.forbidden(),
  }),
  processes: processesSchema,
}).label("WayIn");

const externalStatusMappingSchema = Joi.object({
  source: Joi.string().required(),
  code: codeSchema,
  whileIn: Joi.string().required(),
  mappedTo: Joi.string().required(),
  to: Joi.string().allow(null).required(),
}).label("ExternalStatusMapping");

const grantLifecycleSchema = Joi.object({
  phases: Joi.array().items(lifecyclePhaseSchema).required(),
  initialPosition: positionSchema,
  amendablePositions: Joi.array().items(Joi.string()).required(),
  waysIn: Joi.array().items(wayInSchema).required(),
  externalMappings: Joi.array().items(externalStatusMappingSchema).required(),
  claimApproval: Joi.object({ from: positionSchema, to: positionSchema })
    .allow(null)
    .required()
    .label("ClaimApprovalTransition"),
})
  .allow(null)
  .required()
  .label("GrantLifecycle");

// Why the stored grant cannot give a lifecycle; null beside one, or when the
// grant file is not stored.
const lifecycleProblemSchema = Joi.string().allow(null).required();

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
  phases: pageSchema(
    "phases",
    { lifecycle: grantLifecycleSchema, problem: lifecycleProblemSchema },
    "GrantVersionPhasesPage",
  ),
};
