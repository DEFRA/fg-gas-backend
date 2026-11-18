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

export const counterpartSchema = Joi.object({
  exists: Joi.boolean().required(),
})
  .allow(null)
  .required();

export const positionSchema = Joi.object({
  phase: nullableString,
  stage: nullableString,
  status: nullableString,
})
  .required()
  .label("Position");

const namedSchema = Joi.object({
  code: Joi.string().required(),
  name: nullableString,
}).label("NamedPhase");

// Where the record is, as its version's definition names it; null when that
// cannot be read, and the page shows the codes.
export const positionNamesSchema = Joi.object({
  phases: Joi.array().items(namedSchema).required(),
  stage: nullableString,
  status: nullableString,
})
  .allow(null)
  .label("PositionNames");

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

// A config version's own events, read beside its Overview within a budget.
export const versionEventsSchema = (label, readKeys = {}) =>
  Joi.alternatives()
    .try(
      Joi.object({
        outcome: Joi.string().valid("read").required(),
        events: recordEventsSchema(`${label}Events`),
        sourceErrors: sourceErrorsSchema,
        ...readKeys,
      }),
      Joi.object({
        outcome: Joi.string().valid("timed-out", "failed").required(),
      }),
    )
    .required()
    .label(label);

// One tab of a record page: the header, that tab's keys, and what failed.
export const recordPageSchema = (header, tab, keys, label, sections = [tab]) =>
  Joi.object({
    header,
    ...keys,
    sourceErrors: sourceErrorsSchema,
    sectionErrors: sectionErrorsSchema(
      sections,
      `${label}SectionError`,
    ).required(),
  }).label(label);
