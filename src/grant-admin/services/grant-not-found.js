import Boom from "@hapi/boom";

export {
  GRANT_VERSION_NOT_FOUND,
  configVersionNotFound as grantVersionNotFound,
} from "../../grants/services/config-version.service.js";

export const GRANT_NOT_FOUND = "GRANT_NOT_FOUND";
export const NO_DEFINITION_FILE = "NO_DEFINITION_FILE";

const notFound = (message, reason) => {
  const error = Boom.notFound(message);

  error.output.payload.reason = reason;

  return error;
};

export const grantNotFound = () => notFound("grant not found", GRANT_NOT_FOUND);

export const noDefinitionFile = () =>
  notFound("grant version has no such definition file", NO_DEFINITION_FILE);
