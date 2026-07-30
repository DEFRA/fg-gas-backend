import Joi from "joi";
import { code } from "../grant/code.js";
import { version } from "../grant/version.js";
import { grantRequestSchema } from "./grant-request.schema.js";

export const createGrantRequestSchema = grantRequestSchema
  .concat(
    Joi.object({
      code,
      version: version.optional(),
    }),
  )
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("CreateGrantRequest");
