export const stringValidator = (fieldName, value, validations) => {
  if (
    validations.maxLength !== undefined &&
    value.length > validations.maxLength
  ) {
    return {
      isValid: false,
      error: `${fieldName} exceeds the maximum length of ${validations.maxLength} characters`,
    };
  }
};
