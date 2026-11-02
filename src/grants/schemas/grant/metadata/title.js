import Joi from "joi";

const MAX_TITLE_LENGTH = 500;

export const title = Joi.string().min(1).max(MAX_TITLE_LENGTH);
