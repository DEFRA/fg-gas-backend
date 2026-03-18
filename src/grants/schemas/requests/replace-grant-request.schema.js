import { grantRequestSchema } from "./grant-request.schema.js";

export const replaceGrantRequestSchema = grantRequestSchema
  .options({
    presence: "required",
    stripUnknown: true,
  })
  .label("ReplaceGrantRequest");
