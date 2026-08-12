export const formatValidationErrorPaths = (error) =>
  error.details.map(({ path }) => path.join(".") || "value").join(", ");
