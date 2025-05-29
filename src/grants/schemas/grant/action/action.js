import Joi from "joi";
import { method } from "./method.js";
import { name } from "./name.js";
import { url } from "./url.js";

export const action = Joi.object({
  name,
  method,
  url,
})
  .options({
    presence: "required",
  })
  .label("Action");
