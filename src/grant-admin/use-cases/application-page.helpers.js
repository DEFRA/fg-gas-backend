import { findApplicationSummary } from "../../grants/services/application-read.service.js";
import { findCwCaseExistence } from "../repositories/cw-actuators.repository.js";
import { orNotFound } from "../services/application-not-found.js";
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
