import Joi from "joi";

export const replaceAllowListRequestSchema = Joi.object({
  sbi: Joi.string().allow("").required(),
  crn: Joi.string().allow("").required(),
})
  .unknown(false)
  .required()
  .label("ReplaceAllowListRequest");
