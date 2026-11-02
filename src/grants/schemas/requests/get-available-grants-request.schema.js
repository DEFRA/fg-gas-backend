import Joi from "joi";
import { checkAllowListRequestSchema } from "./check-allow-list-request.schema.js";

export const getAvailableGrantsRequestSchema = Joi.object({
  sbi: checkAllowListRequestSchema.extract("sbi"),
});
