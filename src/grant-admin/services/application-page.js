import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findApplicationSummary } from "../../grants/services/grant-admin.service.js";
import {
  describeError,
  findCwCaseExistence,
} from "../repositories/cw-actuators.repository.js";
import { CW_CASES_SOURCE } from "./event-sources.js";

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

// Unknown, not absent, when Caseworking cannot say: the page still draws.
const readCaseLink = async ({ clientRef, code }) => {
  try {
    const { exists } = await findCwCaseExistence({
      workflowCode: code,
      caseRef: clientRef,
    });

    return { counterpart: { exists: exists === true }, sourceErrors: [] };
  } catch (error) {
    logger.warn(
      `Application page: case link unknown (${describeError(error)})`,
    );

    return { counterpart: null, sourceErrors: [CW_CASES_SOURCE] };
  }
};

export const readApplicationHeader = async ({ clientRef, code }) => {
  const [{ summary }, caseLink] = await Promise.all([
    readApplicationSummary({ clientRef, code }),
    readCaseLink({ clientRef, code }),
  ]);

  return {
    header: {
      clientRef: summary.clientRef,
      code: summary.code,
      position: summary.position,
      counterpart: caseLink.counterpart,
      fetchedAt: new Date().toISOString(),
    },
    accounts: summary.identifiers,
    sourceErrors: caseLink.sourceErrors,
  };
};
