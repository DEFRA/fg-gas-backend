import Joi from "joi";

export const invokeAgreementActionResponse = Joi.object({
  agreement: Joi.object().required(),
  actions: Joi.array().items(Joi.object().unknown(true)).optional(),
  components: Joi.array().items(Joi.object().unknown(true)).required(),
  errors: Joi.array().items(Joi.object().unknown(true)).optional(),
  page: Joi.object({
    id: Joi.string().required(),
    title: Joi.string().required(),
  })
    .unknown(true)
    .required(),
  source: Joi.string().valid("config").required(),
})
  .unknown()
  .label("InvokeAgreementActionResponse");
