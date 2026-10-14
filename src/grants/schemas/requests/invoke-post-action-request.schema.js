import Joi from "joi";

export const invokePostActionRequestSchema = Joi.object({})
  .unknown()
  .label("InvokePostActionRequest");
