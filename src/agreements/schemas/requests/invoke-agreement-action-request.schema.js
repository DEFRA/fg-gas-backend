import Joi from "joi";
import { agreementAccessHeadersSchema } from "./agreement-access-headers.schema.js";

export const agreementNumberParamsSchema = Joi.object({
  agreementNumber: Joi.string().required(),
}).label("AgreementNumberParams");

export const invokeAgreementActionParamsSchema = agreementNumberParamsSchema
  .keys({
    actionName: Joi.string().required(),
  })
  .label("InvokeAgreementActionParams");

export const invokeAgreementActionHeadersSchema = agreementAccessHeadersSchema
  .keys({
    "if-match": Joi.string().required(),
    "idempotency-key": Joi.string().guid({ version: "uuidv4" }).required(),
  })
  .label("InvokeAgreementActionHeaders");

const actionValues = Joi.object()
  .unknown(true)
  .required()
  .label("AgreementActionValues");

export const invokeAgreementActionPayloadSchema = Joi.object({
  values: actionValues,
}).label("InvokeAgreementActionPayload");
