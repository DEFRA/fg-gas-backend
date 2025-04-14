import Joi from "joi";

export const method = Joi.string().valid("GET", "POST").label("ActionMethod");
