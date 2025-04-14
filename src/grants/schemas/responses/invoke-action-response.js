import Joi from "joi";

export const invokeActionResponse = Joi.object({})
  .unknown()
  .label("InvokeActionResponse");
