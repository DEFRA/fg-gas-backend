import Joi from "joi";

export const claimDetailsSchema = Joi.object({
  entitlementId: Joi.string().required(),
  totalClaimAmountPence: Joi.number().integer().min(0).required(),
  // Optional only until grants-ui posts it; make it required then.
  quantity: Joi.number().min(0).optional(),
})
  .unknown(true)
  .required();
