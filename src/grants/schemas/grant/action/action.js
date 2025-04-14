import Joi from "joi";
import { name } from "./name.js";
import { url } from "./url.js";
import { method } from "./method.js";

export const action = Joi.object({
  name,
  method,
  url,
})
  .options({
    presence: "required",
  })
  .label("Action");
