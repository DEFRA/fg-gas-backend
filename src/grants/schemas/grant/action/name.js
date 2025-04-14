import Joi from "joi";

export const name = Joi.string()
  .pattern(/^[a-z0-9-]+$/)
  .min(3)
  .max(100)
  .example("action-name")
  .label("ActionName");
