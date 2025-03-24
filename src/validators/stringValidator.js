export const validateString = (fieldName, value, validations) => {
  if (
    validations.maxLength !== undefined &&
    value.length > validations.maxLength
  ) {
    return {
      isValid: false,
      error: `${fieldName} exceeds the maximum length of ${validations.maxLength} characters`,
    };
  }

  if (
    validations.minLength !== undefined &&
    value.length < validations.minLength
  ) {
    return {
      isValid: false,
      error: `${fieldName} shorter than the minimum length of ${validations.minLength} characters`,
    };
  }

  return {
    isValid: true,
  };
};
