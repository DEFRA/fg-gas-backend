import Joi from "joi";

export const version = Joi.string()
  .pattern(/^\d+\.\d+\.\d+$/)
  .label("version");
