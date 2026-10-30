import Joi from "joi";
import { code } from "../grant/code.js";
import { description } from "../grant/metadata/description.js";
import { title } from "../grant/metadata/title.js";

export const getAvailableGrantsResponseSchema = Joi.object({
  grants: Joi.array()
    .items(
      Joi.object({
        code: code.required(),
        title: title.required(),
        description: description.required(),
      }),
    )
    .unique("code")
    .required(),
}).required();
