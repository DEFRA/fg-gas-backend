import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const agreementNumberParamsSchema = Joi.object({
  agreementNumber: Joi.string().required(),
}).label("AgreementNumberParams");

export const invokeAgreementActionParamsSchema = agreementNumberParamsSchema
  .keys({ actionName: Joi.string().required() })
  .label("InvokeAgreementActionParams");

export const invokeAgreementActionHeadersSchema = Joi.object({
  "if-match": Joi.string()
    .pattern(/^"[^":]+:[1-9]\d*"$/)
    .required(),
  "idempotency-key": Joi.string().guid({ version: "uuidv4" }).required(),
})
  .unknown(true)
  .label("InvokeAgreementActionHeaders");

const agreementReference = Joi.object({
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
})
  .required()
  .label("AgreementActionReference");

const actionValues = Joi.object()
  .unknown(true)
  .required()
  .label("AgreementActionValues");

export const invokeAgreementActionPayloadSchema = Joi.object({
  reference: agreementReference,
  values: actionValues,
}).label("InvokeAgreementActionPayload");
