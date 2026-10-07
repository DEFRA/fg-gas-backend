import { logger } from "../../common/logger.js";
import { findApplicationSummary } from "../../grants/services/application-read.service.js";
import {
  describeError,
  findCwCaseExistence,
} from "../repositories/cw-actuators.repository.js";
import { orNotFound } from "../services/application-not-found.js";

export const readApplicationSummary = async ({ clientRef, code }) =>
  orNotFound(await findApplicationSummary({ clientRef, code }));

// Unknown, not absent, when Caseworking cannot say: the page still draws.
const readCaseLink = async ({ clientRef, code }) => {
  try {
    const { exists } = await findCwCaseExistence({
      workflowCode: code,
      caseRef: clientRef,
    });

    return { exists: exists === true };
  } catch (error) {
    logger.warn(
      `Application page: case link unknown (${describeError(error)})`,
    );

    return null;
  }
};

// Only a tab that shows the case link asks Caseworking for it.
export const readApplicationHeader = async ({
  clientRef,
  code,
  withCounterpart,
}) => {
  const [{ summary }, counterpart] = await Promise.all([
    readApplicationSummary({ clientRef, code }),
    withCounterpart ? readCaseLink({ clientRef, code }) : null,
  ]);

  return {
    header: {
      clientRef: summary.clientRef,
      code: summary.code,
      position: summary.position,
      counterpart,
      fetchedAt: new Date().toISOString(),
    },
    accounts: summary.identifiers,
  };
};
