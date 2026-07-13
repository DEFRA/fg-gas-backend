import Boom from "@hapi/boom";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application-series.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import {
  persistResolvedVersion,
  resolveCurrentGrantUseCase,
} from "./resolve-current-grant.use-case.js";

const replaceApplication = async ({ code, application }, session) => {
  const { clientRef, previousClientRef } = application.metadata;
  logger.info(`Got previousClientRef: ${previousClientRef}.`);

  const previousAppl = await findApplicationByClientRefAndCodeUseCase(
    previousClientRef,
    code,
    session,
  );

  const { grant, resolvedVersion } = await resolveCurrentGrantUseCase(
    code,
    previousAppl.originalConfigVersion,
  );
  await persistResolvedVersion(previousAppl, resolvedVersion);

  if (previousAppl.isReplacementAllowed(grant.amendablePositions)) {
    logger.info("About to update ApplicationSeries");
    const applicationID = await createApplicationUseCase(
      code,
      application,
      session,
    );
    const series = await findByClientRefAndCode(
      previousClientRef,
      code,
      session,
    );
    series.addClientRef(clientRef, applicationID);
    await update(series, session);
    logger.info("Updated ApplicationSeries.");
    return applicationID;
  } else {
    throw Boom.conflict(
      `Can not replace existing Application with clientRef: ${previousClientRef} with new clientRef: ${clientRef} - replacement is not allowed`,
    );
  }
};

export const auditDataBuilder = (args) => {
  const code = args[0].code;
  const newApplication = args[0].application;

  const { clientRef, sbi, frn, crn } = args[0].application.metadata;

  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.REPLACE_APPLICATION,
    entityid: clientRef,
    details: {
      newApplication,
      code,
      sbi,
      frn,
      crn,
    },
    messageGroupId: `submission-${clientRef}`,
  });
};

const replaceApplicationWithAudit = withAudit(
  replaceApplication,
  auditDataBuilder,
);

export const replaceApplicationUseCase = async (code, application) => {
  return withTransaction(async (session) => {
    logger.info(`Replacing application`);
    await replaceApplicationWithAudit({ code, application }, session);
    logger.info("End replacing application.");
  });
};
