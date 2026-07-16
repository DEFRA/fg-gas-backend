import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const getCurrentAgreementQuerySchema = Joi.object({
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
  mode: Joi.string().valid("view", "print").default("view"),
}).label("GetCurrentAgreementQuery");
