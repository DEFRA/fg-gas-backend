import Joi from "joi";
import { code } from "../grant/code.js";

export const getAvailableGrantsResponseSchema = Joi.object({
  grants: Joi.array()
    .items(Joi.object({ code: code.required() }))
    .unique("code")
    .required(),
}).required();
