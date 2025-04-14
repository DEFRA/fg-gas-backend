import Joi from "joi";
import { code } from "../grant/code.js";

export const createGrantResponse = Joi.object({
  code,
}).label("CreateGrantResponse");
