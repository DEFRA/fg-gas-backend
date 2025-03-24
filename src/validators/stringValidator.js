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

  if (validations.pattern !== undefined) {
    const regex = new RegExp(validations.pattern);
    if (!regex.test(value)) {
      return {
        isValid: false,
        error: `${fieldName} must be in the format ${validations.pattern}`,
      };
    }
  }

  return {
    isValid: true,
  };
};
