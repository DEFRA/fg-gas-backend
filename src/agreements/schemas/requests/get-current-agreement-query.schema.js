import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const agreementPresentationQuerySchema = Joi.object({
  mode: Joi.string().valid("view", "print").default("view"),
}).label("AgreementPresentationQuery");

export const getCurrentAgreementQuerySchema = agreementPresentationQuerySchema
  .keys({
    code: code.required(),
    clientRef: clientRef.required(),
    sbi: sbi.required(),
  })
  .label("GetCurrentAgreementQuery");
