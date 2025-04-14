import Joi from "joi";

export const startDate = Joi.date().iso().min("now");
