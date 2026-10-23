import Joi from "joi";

// Caseworking stores workflows under codes that may be upper case.
export const workflowCode = Joi.string()
  .max(128)
  .pattern(/^[a-zA-Z0-9-]+$/)
  .example("Casework-Smoke")
  .label("code");
