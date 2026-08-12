import Boom from "@hapi/boom";
import { formatValidationErrorPaths } from "../format-validation-error-paths.js";

const validationOptions = {
  abortEarly: false,
  allowUnknown: false,
  convert: true,
};

export const validateMappedValue = (schema, value, message) => {
  const result = schema.validate(value, validationOptions);

  if (result.error) {
    throw Boom.badImplementation(
      `${message} at: ${formatValidationErrorPaths(result.error)}`,
    );
  }

  return structuredClone(result.value);
};
