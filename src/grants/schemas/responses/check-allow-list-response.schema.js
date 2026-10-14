import Joi from "joi";

export const checkAllowListResponseSchema = Joi.object({
  allowed: Joi.boolean().strict().required(),
}).required();
