import Boom from "@hapi/boom";
import {
  auditActions,
  auditEntities,
  buildAuditEvent,
} from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { withAudit } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application-series.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";

const replaceApplication = async ({ code, application }, session) => {
  const { clientRef, previousClientRef } = application.metadata;
  logger.info(`Got previousClientRef: ${previousClientRef}.`);

  const grant = await findByCode(code);

  const previousAppl = await findApplicationByClientRefAndCodeUseCase(
    previousClientRef,
    code,
    session,
  );

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
  } else {
    throw Boom.conflict(
      `Can not replace existing Application with clientRef: ${previousClientRef} with new clientRef: ${clientRef} - replacement is not allowed`,
    );
  }
  logger.info("End replacing application.");
};

const auditDataBuilder = (args) => {
  const [{ code, application }] = args;
  const { clientRef, previousClientRef } = application.metadata;
  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.REPLACE_APPLICATION,
    entityid: clientRef,
    details: { code, previousClientRef },
  });
};

const replaceApplicationWithAudit = withAudit(
  replaceApplication,
  auditDataBuilder,
);

export const replaceApplicationUseCase = (code, application) =>
  withTransaction((session) =>
    replaceApplicationWithAudit({ code, application }, session),
  );
