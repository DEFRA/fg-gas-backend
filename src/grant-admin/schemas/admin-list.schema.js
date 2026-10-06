import Joi from "joi";

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
