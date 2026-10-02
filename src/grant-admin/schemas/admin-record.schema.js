import Joi from "joi";
import { eventSourceErrorSchema } from "./events-shared.schema.js";

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

export const listPaginationSchema = Joi.object({
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
})
  .required()
  .label("ListPagination");

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
