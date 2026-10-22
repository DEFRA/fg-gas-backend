import Boom from "@hapi/boom";

export {
  GRANT_VERSION_NOT_FOUND,
  configVersionNotFound as grantVersionNotFound,
} from "../../grants/services/config-version.service.js";

export const GRANT_NOT_FOUND = "GRANT_NOT_FOUND";

export const grantNotFound = () => {
  const error = Boom.notFound("grant not found");

  error.output.payload.reason = GRANT_NOT_FOUND;

  return error;
};
