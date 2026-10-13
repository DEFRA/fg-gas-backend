import Joi from "joi";
import {
  eventRowSchema,
  eventSourceErrorSchema,
} from "./events-shared.schema.js";
import { sectionErrorsSchema } from "./section-errors.schema.js";

// Shared by Grant Admin's record pages. Every fact may be null: a
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

// `members` are oldest first.
export const seriesSchema = (
  memberSchema,
  label,
  { membersOptional = false } = {},
) => {
  const members = Joi.array().items(memberSchema);

  return Joi.object({
    latestRef: nullableString,
    refs: Joi.array().items(Joi.string()).required(),
    members: membersOptional ? members.optional() : members.required(),
  })
    .allow(null)
    .required()
    .label(label);
};

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
    // A queue held more than the tab reads from it.
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
