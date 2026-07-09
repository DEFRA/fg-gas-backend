import Joi from "joi";

export const code = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .example("pigs-might-fly")
  .label("code");
