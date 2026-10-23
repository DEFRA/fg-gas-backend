import Boom from "@hapi/boom";

export const GRANT_VERSION_NOT_FOUND = "GRANT_VERSION_NOT_FOUND";

export const configVersionNotFound = () => {
  const error = Boom.notFound("grant version not found");

  error.output.payload.reason = GRANT_VERSION_NOT_FOUND;

  return error;
};
