import Joi from "joi";
import { bucketCatalogueResponseSchema } from "./bucket.schema.js";

const shellSchema = Joi.object({
  catalogue: bucketCatalogueResponseSchema.required(),
})
  .allow(null)
  .label("Shell");

export const shellResponseSchema = Joi.object({
  shell: shellSchema.required(),
}).label("ShellResponse");
