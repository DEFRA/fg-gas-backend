import Joi from "joi";

export const eventStatusResponseSchema = Joi.object({
  status: Joi.string().required().example("RESUBMITTED"),
  statusLabel: Joi.string().required().example("Resubmitted"),
  attemptsSinceRedrive: Joi.number().integer().min(0).required().example(2),
  maxAttempts: Joi.number().integer().min(0).required().example(5),
}).label("EventStatus");
