import Joi from "joi";

export const submittedAt = Joi.date().iso();
