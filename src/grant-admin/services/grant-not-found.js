import Boom from "@hapi/boom";

export const GRANT_NOT_FOUND = "GRANT_NOT_FOUND";
export const GRANT_VERSION_NOT_FOUND = "GRANT_VERSION_NOT_FOUND";
export const NO_DEFINITION_FILE = "NO_DEFINITION_FILE";

const notFound = (message, reason) => {
  const error = Boom.notFound(message);

  error.output.payload.reason = reason;

  return error;
};

export const grantNotFound = () => notFound("grant not found", GRANT_NOT_FOUND);

export const grantVersionNotFound = () =>
  notFound("grant version not found", GRANT_VERSION_NOT_FOUND);

export const noDefinitionFile = () =>
  notFound("grant version has no such definition file", NO_DEFINITION_FILE);
