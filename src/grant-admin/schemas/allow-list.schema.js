import Joi from "joi";
import { code } from "./code.js";

const identifiers = Joi.array().items(Joi.string().allow("")).required();

export const allowListParamsSchema = Joi.object({
  code: code.required(),
}).label("AllowListParams");

export const allowListGlobalSchema = Joi.object({
  sbi: identifiers,
  crn: identifiers,
})
  .unknown(false)
  .required()
  .label("AllowListGlobal");

export const replaceAllowListRequestSchema = Joi.object({
  global: allowListGlobalSchema,
})
  .unknown(false)
  .required()
  .label("ReplaceAllowListRequest");

export const allowListResponseSchema = Joi.object({
  grantCode: code.required(),
  global: allowListGlobalSchema,
})
  .unknown(false)
  .required()
  .label("AllowListResponse");
