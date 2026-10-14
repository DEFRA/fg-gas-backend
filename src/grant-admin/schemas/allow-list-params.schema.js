import Joi from "joi";
import { code } from "./code.js";

export const allowListParamsSchema = Joi.object({
  code: code.required(),
}).label("AllowListParams");
