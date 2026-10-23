import Joi from "joi";

export const version = Joi.string()
  .pattern(/^\d+\.\d+\.\d+$/)
  .example("1.2.0")
  .label("version");
