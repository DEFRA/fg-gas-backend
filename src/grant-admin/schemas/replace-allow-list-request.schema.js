import Joi from "joi";
import { allowListGlobalSchema } from "./allow-list-global.schema.js";

export const replaceAllowListRequestSchema = Joi.object({
  global: allowListGlobalSchema,
})
  .unknown(false)
  .required()
  .label("ReplaceAllowListRequest");
