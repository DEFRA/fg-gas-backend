import Joi from "joi";

export const agreementNumberParamsSchema = Joi.object({
  agreementNumber: Joi.string().required(),
}).label("AgreementNumberParams");

export const invokeAgreementActionParamsSchema = agreementNumberParamsSchema
  .keys({
    agreementItemId: Joi.string().required(),
    actionName: Joi.string().required(),
  })
  .label("InvokeAgreementActionParams");

export const invokeAgreementActionHeadersSchema = Joi.object({
  "if-match": Joi.string().required(),
  "idempotency-key": Joi.string().guid({ version: "uuidv4" }).required(),
})
  .unknown(true)
  .label("InvokeAgreementActionHeaders");

const actionValues = Joi.object()
  .unknown(true)
  .required()
  .label("AgreementActionValues");

export const invokeAgreementActionPayloadSchema = Joi.object({
  values: actionValues,
}).label("InvokeAgreementActionPayload");
