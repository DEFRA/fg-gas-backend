import Joi from "joi";
import { configVersion } from "../application/metadata/config-version.js";
import { code } from "../grant/code.js";

export const checkAllowListRequestSchema = Joi.object({
  grantCode: code.required(),
  sbi: Joi.string()
    .pattern(/^\d{9}$/)
    .required(),
  crn: Joi.string()
    .pattern(/^\d{10}$/)
    .required(),
});

export const checkAllowListQuerySchema = Joi.object({
  configVersion: configVersion.required(),
});
