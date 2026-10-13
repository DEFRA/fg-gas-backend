import Joi from "joi";
import { allowListGlobalSchema } from "./allow-list-global.schema.js";
import { code } from "./code.js";

export const allowListResponseSchema = Joi.object({
  grantCode: code.required(),
  adminRole: Joi.string().required(),
  global: allowListGlobalSchema,
})
  .unknown(false)
  .required()
  .label("AllowListResponse");
