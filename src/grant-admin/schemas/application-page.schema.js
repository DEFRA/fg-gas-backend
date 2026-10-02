import Joi from "joi";
import {
  nullableIso,
  nullableString,
  positionSchema,
  recordEventsSchema,
  recordPageSchema,
  seriesSchema,
  storedBytesSchema as storedBytes,
} from "./admin-record.schema.js";

const applicationHeaderSchema = Joi.object({
  clientRef: Joi.string().required(),
  code: Joi.string().required(),
  position: positionSchema,
  // Null while the case link is unknown.
  counterpart: Joi.object({ exists: Joi.boolean().required() })
    .allow(null)
    .required(),
  fetchedAt: Joi.string().isoDate().required(),
})
  .required()
  .label("ApplicationHeader");

const overviewSchema = Joi.object({
  code: Joi.string().required(),
  originalConfigVersion: nullableString,
  currentConfigVersion: nullableString,
  submittedAt: nullableIso,
  createdAt: nullableIso,
  updatedAt: nullableIso,
  identifiers: Joi.object({
    sbi: nullableString,
    frn: nullableString,
    crn: nullableString,
  }).required(),
  series: seriesSchema,
  storedBytes,
})
  .allow(null)
  .required()
  .label("ApplicationOverview");

const eventsSchema = recordEventsSchema("ApplicationEvents");

// The stored document as stored: answers and metadata are never validated.
const rawSchema = Joi.object().unknown(true).allow(null).required();

const pageSchema = (tab, keys, label) =>
  recordPageSchema(applicationHeaderSchema, tab, keys, label);

export const applicationPageSchemas = {
  overview: pageSchema(
    "overview",
    { overview: overviewSchema },
    "ApplicationOverviewPage",
  ),
  events: pageSchema(
    "events",
    { events: eventsSchema },
    "ApplicationEventsPage",
  ),
  raw: pageSchema("raw", { raw: rawSchema, storedBytes }, "ApplicationRawPage"),
};
