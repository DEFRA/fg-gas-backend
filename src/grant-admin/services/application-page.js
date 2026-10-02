import Boom from "@hapi/boom";
import { findApplicationSummary } from "../../grants/services/grant-admin.service.js";

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

export const readApplicationSummary = async ({ clientRef, code }) =>
  orNotFound(await findApplicationSummary({ clientRef, code }));

// The case link stays unknown until Grant Admin can ask Caseworking.
export const readApplicationHeader = async ({ clientRef, code }) => {
  const { summary } = await readApplicationSummary({ clientRef, code });

  return {
    header: {
      clientRef: summary.clientRef,
      code: summary.code,
      position: summary.position,
      counterpart: null,
      fetchedAt: new Date().toISOString(),
    },
    accounts: summary.identifiers,
    sourceErrors: [],
  };
};
