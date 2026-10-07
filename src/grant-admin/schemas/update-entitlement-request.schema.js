import Joi from "joi";
import { fieldValue } from "./create-entitlement-request.schema.js";

export const updateEntitlementRequestSchema = Joi.object({
  data: Joi.object().pattern(Joi.string(), fieldValue).min(1).required(),
}).label("UpdateEntitlementRequest");
