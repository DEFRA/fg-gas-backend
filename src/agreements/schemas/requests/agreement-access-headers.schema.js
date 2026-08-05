import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const agreementAccessHeadersSchema = Joi.object({
  "x-agreement-source": Joi.string().valid("defra", "entra").required(),
  "x-agreement-code": code.required(),
  "x-agreement-sbi": sbi.required(),
})
  .unknown(true)
  .label("AgreementAccessHeaders");

export const agreementIdentityHeadersSchema = Joi.object({
  "x-agreement-code": code.required(),
  "x-agreement-client-ref": clientRef.required(),
  "x-agreement-sbi": sbi.required(),
})
  .unknown(true)
  .label("AgreementIdentityHeaders");
