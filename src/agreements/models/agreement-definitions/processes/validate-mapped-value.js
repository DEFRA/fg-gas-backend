import Boom from "@hapi/boom";

const validationOptions = {
  abortEarly: false,
  allowUnknown: false,
  convert: true,
};

const validationPaths = (error) =>
  error.details.map(({ path }) => path.join(".") || "value").join(", ");

export const validateMappedValue = (schema, value, message) => {
  const result = schema.validate(value, validationOptions);

  if (result.error) {
    throw Boom.badImplementation(
      `${message} at: ${validationPaths(result.error)}`,
    );
  }

  return structuredClone(result.value);
};
