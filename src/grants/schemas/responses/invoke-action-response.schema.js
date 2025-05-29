import Joi from "joi";

export const invokeActionResponseSchema = Joi.object({})
  .unknown()
  .label("InvokeActionResponse");
