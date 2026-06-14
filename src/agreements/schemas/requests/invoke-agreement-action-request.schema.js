import Joi from "joi";

export const invokeAgreementActionRequest = Joi.object({
  clientRef: Joi.string().required(),
  code: Joi.string().required(),
  acceptedBy: Joi.string().optional(),
})
  .unknown()
  .label("InvokeAgreementActionRequest");
