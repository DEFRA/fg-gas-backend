import Joi from "joi";

export const validateString = (fieldName, value, validations) => {
  let schema = Joi.string();

  if (validations.maxLength !== undefined) {
    schema = schema
      .max(validations.maxLength)
      .required()
      .messages({
        "string.base": `${fieldName} must be a string`,
        "string.empty": `${fieldName} cannot be empty`,
        "string.max": `${fieldName} exceeds the maximum length of ${validations.maxLength} characters`,
      });
  }

  if (validations.minLength !== undefined) {
    schema = schema
      .min(validations.minLength)
      .required()
      .messages({
        "string.base": `${fieldName} must be a string`,
        "string.empty": `${fieldName} cannot be empty`,
        "string.min": `${fieldName} shorter than the minimum length of ${validations.minLength} characters`,
      });
  }

  if (validations.pattern !== undefined) {
    try {
      const regex = new RegExp(validations.pattern);
      schema = schema.pattern(regex).messages({
        "string.pattern.base": `${fieldName} must be in the format ${validations.pattern}`,
      });
    } catch (error) {
      return {
        isValid: false,
        error: `Invalid regular expression pattern: ${validations.pattern}`,
      };
    }
  }

  const result = schema.validate(value);

  if (result.error) {
    return {
      isValid: false,
      error: result.error.message,
    };
  }

  return {
    isValid: true,
  };
};
