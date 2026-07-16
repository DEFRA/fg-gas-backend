import Joi from "joi";
import { clientRef } from "../agreement/client-ref.js";
import { code } from "../agreement/code.js";
import { sbi } from "../agreement/sbi.js";

export const getAgreementPageModelQuerySchema = Joi.object({
  code: code.required(),
  clientRef: clientRef.required(),
  sbi: sbi.required(),
  page: Joi.string().required(),
  mode: Joi.string().default("view"),
}).label("GetAgreementPageModelQuery");
