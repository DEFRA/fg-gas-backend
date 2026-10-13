import Joi from "joi";

const identifiers = Joi.array().items(Joi.string().allow("")).required();

export const allowListGlobalSchema = Joi.object({
  sbi: identifiers,
  crn: identifiers,
})
  .unknown(false)
  .required()
  .label("AllowListGlobal");
