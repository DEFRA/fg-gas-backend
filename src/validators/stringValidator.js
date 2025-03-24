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

  // if (validations.minLength !== undefined) {
  //   schema = schema.min(validations.minLength)
  //     .message(`${fieldName} shorter than the minimum length of ${validations.minLength} characters`);
  // }
  //
  // if (validations.pattern !== undefined) {
  //   schema = schema.pattern(new RegExp(validations.pattern))
  //     .message(`${fieldName} must be in the format ${validations.pattern}`);
  // }

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
