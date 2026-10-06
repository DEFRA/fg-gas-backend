import Boom from "@hapi/boom";

export const APPLICATION_NOT_FOUND = "APPLICATION_NOT_FOUND";

// A fixed message: the ref is in the URL already and never in a log line.
export const applicationNotFound = () => {
  const error = Boom.notFound("application not found");

  error.output.payload.reason = APPLICATION_NOT_FOUND;

  return error;
};

export const orNotFound = (found) => {
  if (!found) {
    throw applicationNotFound();
  }

  return found;
};
