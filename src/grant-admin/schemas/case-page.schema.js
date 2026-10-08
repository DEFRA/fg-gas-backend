import Joi from "joi";
import { clientRef } from "../../common/schemas/client-ref.js";
import {
  nullableIso,
  nullableString,
  positionSchema,
  recordEventsSchema,
  recordPageSchema,
  seriesSchema,
  storedBytesSchema as storedBytes,
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
  closed: Joi.boolean().allow(null).required(),
  closedAt: nullableIso,
  // Null while GAS cannot say whether the application exists.
  counterpart: Joi.object({ exists: Joi.boolean().required() })
    .allow(null)
    .required(),
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

// The stored case as Caseworking keeps it, less its notes: never validated.
const rawSchema = Joi.object({ comments: Joi.any().forbidden() })
  .unknown(true)
  .allow(null)
  .required();

const pageSchema = (tab, keys, label) =>
  recordPageSchema(caseHeaderSchema, tab, keys, label);

export const casePageSchemas = {
  overview: pageSchema(
    "overview",
    { overview: overviewSchema },
    "CaseOverviewPage",
  ),
  events: pageSchema("events", { events: eventsSchema }, "CaseEventsPage"),
  raw: pageSchema("raw", { raw: rawSchema, storedBytes }, "CaseRawPage"),
};
