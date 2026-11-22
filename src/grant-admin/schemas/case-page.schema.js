import Joi from "joi";
import { clientRef } from "../../common/schemas/client-ref.js";
import {
  counterpartSchema,
  nullableIso,
  nullableString,
  positionNamesSchema,
  positionSchema,
  recordEventsSchema,
  recordPageSchema,
  seriesSchema,
  storedBytesSchema as storedBytes,
  storedDocumentSchema,
} from "./admin-record.schema.js";
import { code } from "./code.js";

export const caseParamsSchema = Joi.object({
  workflowCode: code,
  // A case's ref is its application's.
  caseRef: clientRef,
}).label("CaseParams");

const caseHeaderSchema = Joi.object({
  caseRef: Joi.string().required(),
  workflowCode: Joi.string().required(),
  position: positionSchema,
  version: nullableString,
  names: positionNamesSchema.required(),
  closed: Joi.boolean().allow(null).required(),
  closedAt: nullableIso,
  // Null while GAS cannot say whether the application exists.
  counterpart: counterpartSchema,
  fetchedAt: Joi.string().isoDate().required(),
})
  .required()
  .label("CaseHeader");

const seriesMemberSchema = Joi.object({
  caseRef: Joi.string().required(),
  position: positionSchema,
  createdAt: nullableIso,
  closedAt: nullableIso,
}).label("CaseSeriesMember");

const overviewSchema = Joi.object({
  workflowCode: Joi.string().required(),
  originalConfigVersion: nullableString,
  currentConfigVersion: nullableString,
  createdAt: nullableIso,
  closed: Joi.boolean().allow(null).required(),
  closedAt: nullableIso,
  // Members are absent from a Caseworking that predates them.
  series: seriesSchema(seriesMemberSchema, "CaseSeries", {
    membersOptional: true,
  }),
  storedBytes,
})
  .allow(null)
  .required()
  .label("CaseOverview");

const eventsSchema = recordEventsSchema("CaseEvents");

// The stored case as Caseworking keeps it, whole.
const documentSchema = storedDocumentSchema("CaseDocument");

const pageSchema = (tab, keys, label) =>
  recordPageSchema(caseHeaderSchema, tab, keys, label);

export const casePageSchemas = {
  overview: pageSchema(
    "overview",
    { overview: overviewSchema },
    "CaseOverviewPage",
  ),
  events: pageSchema("events", { events: eventsSchema }, "CaseEventsPage"),
  raw: pageSchema(
    "raw",
    { document: documentSchema, storedBytes },
    "CaseRawPage",
  ),
};
