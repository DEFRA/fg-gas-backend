import Joi from "joi";

const grantTypeSchema = Joi.object({
  code: Joi.string().required(),
  name: Joi.string().allow(null).required(),
})
  .unknown(false)
  .label("GrantType");

export const grantTypesViewSchema = Joi.object({
  grantTypes: Joi.array().items(grantTypeSchema).required(),
})
  .unknown(false)
  .required()
  .label("GrantTypesView");
