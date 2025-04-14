import Joi from "joi";

export const payload = Joi.object({}).unknown().label("ActionPayload");
