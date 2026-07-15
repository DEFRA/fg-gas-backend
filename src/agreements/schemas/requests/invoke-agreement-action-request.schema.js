import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const invokeAgreementActionParamsSchema = Joi.object({
  agreementNumber: Joi.string().required(),
  actionName: Joi.string().required(),
}).label("InvokeAgreementActionParams");

export const invokeAgreementActionPayloadSchema = Joi.object({
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
})
  .unknown(true)
  .label("InvokeAgreementActionPayload");
