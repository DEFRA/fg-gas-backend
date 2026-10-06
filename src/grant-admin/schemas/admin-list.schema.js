import Joi from "joi";
import { clientRef } from "../../common/schemas/client-ref.js";
import { code } from "./code.js";

// A string, not a Date: each box coerces the bound to its own stored type.
export const rangeBound = () => Joi.string().isoDate();

// Compared as instants: offset-bearing strings order differently lexically.
export const assertRange = (value, helpers) =>
  value.from && value.to && Date.parse(value.from) > Date.parse(value.to)
    ? helpers.error("any.invalid")
    : value;

export const listPaginationSchema = Joi.object({
  endCursor: Joi.string().allow(null).required(),
  hasNextPage: Joi.boolean().required(),
}).label("ListPagination");

const REF_MAX = 100;
const CURSOR_MAX = 512;

// A list page: a browse narrowed by code and created time, or a ref search.
export const listRequestSchema = (codeKey, label) =>
  Joi.object({
    ref: clientRef
      .trim()
      .lowercase()
      .max(REF_MAX)
      .empty("")
      .optional()
      .example("gld-9b2-bws"),
    [codeKey]: code.optional(),
    from: rangeBound().optional().example("2026-06-16T00:00:00.000Z"),
    to: rangeBound().optional().example("2026-06-16T23:59:59.999Z"),
    cursor: Joi.string().max(CURSOR_MAX).optional(),
  })
    // A ref search is one page: there is nothing after it to continue to.
    .nand("ref", "cursor")
    .custom(assertRange)
    .messages({ "any.invalid": '"from" must be earlier than or equal to "to"' })
    .label(label);
