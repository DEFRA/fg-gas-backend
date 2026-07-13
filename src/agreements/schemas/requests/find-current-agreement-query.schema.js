import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const findCurrentAgreementQuerySchema = Joi.object({
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
}).label("FindCurrentAgreementQuery");
