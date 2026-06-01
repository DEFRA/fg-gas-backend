import Joi from "joi";
import { code } from "../grant/code.js";
import { grantRequestSchema } from "./grant-request.schema.js";

export const createGrantRequestSchema = grantRequestSchema
  .concat(
    Joi.object({
      code,
      version: Joi.string()
        .pattern(/^\d+\.\d+\.\d+$/)
        .optional(),
    }),
  )
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("CreateGrantRequest");
