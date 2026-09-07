import Joi from "joi";
import { clientRef } from "../../common/schemas/client-ref.js";
import { code } from "./code.js";

const fieldValue = Joi.object({
  value: Joi.alternatives()
    .try(Joi.string(), Joi.number(), Joi.boolean())
    .required(),
}).label("EntitlementFieldValue");

export const createEntitlementRequestSchema = Joi.object({
  clientRef: clientRef.required(),
  grantCode: code.required(),
  claimCode: Joi.string().required(),
  data: Joi.object().pattern(Joi.string(), fieldValue).min(1).required(),
}).label("CreateEntitlementRequest");
