import Joi from "joi";

// `error` is the stored message verbatim, so it can be passed back as the list filter.
const breakdownGroupSchema = Joi.object({
  error: Joi.string().allow("", null).required().example("No handler found"),
  type: Joi.string().required().example("case.status.updated"),
  count: Joi.number().integer().min(1).required(),
  firstAt: Joi.string().isoDate().allow(null).required(),
  lastAt: Joi.string().isoDate().allow(null).required(),
}).label("EventBreakdownGroup");

// Capped at twenty groups: past that an operator is reading noise.
export const breakdownEventsResponseSchema = Joi.object({
  groups: Joi.array().items(breakdownGroupSchema).required(),
}).label("BreakdownEventsResponse");
