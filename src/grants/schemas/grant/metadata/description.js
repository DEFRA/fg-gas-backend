import Joi from "joi";

export const description = Joi.string().min(1).max(500);
