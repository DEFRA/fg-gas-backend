import Joi from "joi";
const semverRegex = /^\d+\.\d+\.\d+$/;
export const configVersion = Joi.string().pattern(semverRegex);
