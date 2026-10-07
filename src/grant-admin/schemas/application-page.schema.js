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

export const applicationParamsSchema = Joi.object({
  code,
  clientRef,
}).label("ApplicationParams");

// Shown as stored when not an instant, so an odd legacy value never fails the page.
const storedTimestamp = Joi.string().allow(null, "").required();

const applicationHeaderSchema = Joi.object({
  clientRef: Joi.string().required(),
  code: Joi.string().required(),
  position: positionSchema,
  // Null while the case link is unknown, and on a tab that does not show it.
  counterpart: Joi.object({ exists: Joi.boolean().required() })
    .allow(null)
    .required(),
  fetchedAt: Joi.string().isoDate().required(),
})
  .required()
  .label("ApplicationHeader");

const seriesMemberSchema = Joi.object({
  clientRef: Joi.string().required(),
  position: positionSchema,
  createdAt: nullableIso,
}).label("ApplicationSeriesMember");

const overviewSchema = Joi.object({
  code: Joi.string().required(),
  originalConfigVersion: nullableString,
  currentConfigVersion: nullableString,
  submittedAt: storedTimestamp,
  createdAt: nullableIso,
  updatedAt: storedTimestamp,
  identifiers: Joi.object({
    sbi: nullableString,
    frn: nullableString,
    crn: nullableString,
  }).required(),
  series: seriesSchema(seriesMemberSchema, "ApplicationSeries"),
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
