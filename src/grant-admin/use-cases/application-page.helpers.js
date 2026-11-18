import { logger } from "../../common/logger.js";
import { findApplicationSummary } from "../../grants/services/application-read.service.js";
import { findGrantPhaseNames } from "../../grants/services/config-version.service.js";
import { findCwCaseExistence } from "../repositories/cw-actuators.repository.js";
import { describeError } from "../repositories/cw-http.js";
import { orNotFound } from "../services/application-not-found.js";
import { namePosition } from "../services/position-names.js";
import { readCounterpart } from "./read-counterpart.js";

export const readApplicationSummary = async ({ clientRef, code }) =>
  orNotFound(await findApplicationSummary({ clientRef, code }));

const readCaseLink = ({ clientRef, code }) =>
  readCounterpart(
    "Application page: case link",
    async () =>
      (await findCwCaseExistence({ workflowCode: code, caseRef: clientRef }))
        .exists === true,
  );

// The names of the grant version the application is on; none when it is on
// none, or its definition cannot be read.
const readNames = async ({ code, currentConfigVersion, position }) => {
  if (!currentConfigVersion) {
    return null;
  }

  try {
    const phases = await findGrantPhaseNames({
      code,
      version: currentConfigVersion,
    });

    return phases ? namePosition(phases, position) : null;
  } catch (error) {
    logger.warn(`Application page: names unread (${describeError(error)})`);

    return null;
  }
};

const readSummaryAndNames = async (ref) => {
  const { summary } = await readApplicationSummary(ref);

  return { summary, names: await readNames(summary) };
};

// Only a tab that shows the case link asks Caseworking for it.
export const readApplicationHeader = async ({
  clientRef,
  code,
  withCounterpart,
}) => {
  const [{ summary, names }, counterpart] = await Promise.all([
    readSummaryAndNames({ clientRef, code }),
    withCounterpart ? readCaseLink({ clientRef, code }) : null,
  ]);

  return {
    header: {
      clientRef: summary.clientRef,
      code: summary.code,
      position: summary.position,
      version: summary.currentConfigVersion,
      names,
      counterpart,
      fetchedAt: new Date().toISOString(),
    },
    accounts: summary.identifiers,
  };
};
