import Joi from "joi";

export const url = Joi.string()
  .uri()
  .example("https://example.com/api/v1/action")
  .label("ActionUrl");
