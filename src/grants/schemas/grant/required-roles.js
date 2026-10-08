import Joi from "joi";

export const requiredRoles = Joi.object({
  allOf: Joi.array().items(Joi.string()).default([]),
  anyOf: Joi.array().items(Joi.string()).default([]),
})
  .unknown(false)
  .label("RequiredRoles");
