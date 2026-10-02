import Joi from "joi";
import {
  nullableIso,
  nullableString,
  positionSchema,
  seriesSchema,
  sourceErrorsSchema,
} from "./admin-record.schema.js";
import { eventRowSchema } from "./events-shared.schema.js";
import { sectionErrorsSchema } from "./section-errors.schema.js";

const storedBytes = Joi.number().integer().min(0).allow(null).required();

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

const eventsSchema = Joi.object({
  rows: Joi.array().items(eventRowSchema).required(),
  // More than one page matched: the admin links on to the events search.
  more: Joi.boolean().required(),
})
  .allow(null)
  .required()
  .label("ApplicationEvents");

// The stored document as stored: answers and metadata are never validated.
const rawSchema = Joi.object().unknown(true).allow(null).required();

const pageSchema = (tab, keys, label) =>
  Joi.object({
    header: applicationHeaderSchema,
    ...keys,
    sourceErrors: sourceErrorsSchema,
    sectionErrors: sectionErrorsSchema(
      [tab],
      `${label}SectionError`,
    ).required(),
  }).label(label);

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
