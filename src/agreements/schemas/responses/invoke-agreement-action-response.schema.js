import Joi from "joi";

export const invokeAgreementActionResponse = Joi.object({
  agreementNumber: Joi.string().required(),
  clientRef: Joi.string().required(),
  code: Joi.string().required(),
  status: Joi.string().required(),
})
  .unknown()
  .label("InvokeAgreementActionResponse");
