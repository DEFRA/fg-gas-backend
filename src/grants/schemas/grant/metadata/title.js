import Joi from "joi";

export const title = Joi.string().min(1).max(500);
