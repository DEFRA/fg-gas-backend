import Joi from "joi";

export const invokePostActionRequest = Joi.object({})
  .unknown()
  .label("InvokePostActionRequest");
