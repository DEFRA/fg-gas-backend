import Joi from "joi";

export const clientRef = Joi.string().pattern(/^[a-z0-9-]+$/);
