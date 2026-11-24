import Joi from "joi";

export const homeViewSchema = Joi.object({
  grantTypeCount: Joi.number().integer().min(0).required(),
})
  .unknown(false)
  .required()
  .label("HomeView");
