import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const invokeAgreementActionParamsSchema = Joi.object({
  agreementNumber: Joi.string().required(),
  actionName: Joi.string().required(),
}).label("InvokeAgreementActionParams");

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
