import Joi from "joi";
import {
  eventRowSchema,
  eventSourceErrorSchema,
} from "./events-shared.schema.js";
import { sectionErrorsSchema } from "./section-errors.schema.js";

// Shared by Grant Admin's record lists and pages. Every fact may be null: a
// legacy or odd document must not make the debugging tool answer 500.

export const nullableString = Joi.string().allow(null).required();

export const nullableIso = Joi.string().isoDate().allow(null).required();

export const positionSchema = Joi.object({
  phase: nullableString,
  stage: nullableString,
  status: nullableString,
})
  .required()
  .label("Position");

export const seriesSchema = Joi.object({
  latestRef: nullableString,
  refs: Joi.array().items(Joi.string()).required(),
})
  .allow(null)
  .required()
  .label("Series");

// Present on a first page only; a later page keeps the first page's.
export const listTotalSchema = Joi.object({
  count: Joi.number().integer().min(0).required(),
  capped: Joi.boolean().required(),
})
  .optional()
  .label("ListTotal");

export const sourceErrorsSchema = Joi.array()
  .items(eventSourceErrorSchema)
  .required();

export const storedBytesSchema = Joi.number()
  .integer()
  .min(0)
  .allow(null)
  .required();

export const recordEventsSchema = (label) =>
  Joi.object({
    rows: Joi.array().items(eventRowSchema).required(),
    // More than one page matched: the admin links on to the events search.
    more: Joi.boolean().required(),
  })
    .allow(null)
    .required()
    .label(label);

// One tab of a record page: the header, that tab's keys, and what failed.
export const recordPageSchema = (header, tab, keys, label) =>
  Joi.object({
    header,
    ...keys,
    sourceErrors: sourceErrorsSchema,
    sectionErrors: sectionErrorsSchema(
      [tab],
      `${label}SectionError`,
    ).required(),
  }).label(label);
