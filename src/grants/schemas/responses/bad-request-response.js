import Joi from "joi";

export const badRequestResponse = Joi.object({
  statusCode: Joi.number().example(400),
  error: Joi.string().example("Bad Request"),
  message: Joi.string().example("Grant code must be a valid code"),
  validation: Joi.object({
    keys: Joi.array().items(Joi.string().example("code")),
    source: Joi.string().example("payload"),
  }).optional(),
})
  .options({
    presence: "required",
  })
  .label("BadRequestResponse");
