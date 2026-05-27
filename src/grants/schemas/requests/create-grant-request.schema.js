import Joi from "joi";
import { code } from "../grant/code.js";
import { grantRequestSchema } from "./grant-request.schema.js";

export const createGrantRequestSchema = grantRequestSchema
  .concat(
    Joi.object({
      code,
    }),
  )
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("CreateGrantRequest");
