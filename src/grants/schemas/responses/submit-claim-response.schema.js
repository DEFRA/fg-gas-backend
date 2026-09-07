import Joi from "joi";

export const submitClaimResponseSchema = Joi.object({
  claimId: Joi.string().required(),
})
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("SubmitClaimResponse");
