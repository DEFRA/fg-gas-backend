import Joi from "joi";

const SBI_LENGTH = 9;

export const sbi = Joi.string().length(SBI_LENGTH);
