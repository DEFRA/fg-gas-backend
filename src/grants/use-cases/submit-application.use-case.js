import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { buildAuditEvent, withAudit } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationSeries } from "../models/application-series.js";
import { save as saveSeries } from "../repositories/application-series.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";

const auditDataBuilder = (args, results) => {
  const code = args[0].code;
  const { clientRef, sbi, frn, crn } = args[0].submission.metadata;

  return buildAuditEvent({
    entity: auditEntities.APPLICATION,
    action: auditActions.SUBMIT_APPLICATION,
    entityid: clientRef,
    details: {
      applicationId: results,
      code,
      sbi,
      frn,
      crn,
    },
    messageGroupId: `submission-${clientRef}`,
  });
};

const submitApplication = async ({ code, submission }, session) => {
  const applicationID = await createApplicationUseCase(
    code,
    submission,
    session,
  );
  const series = ApplicationSeries.new({
    latestClientRef: submission.metadata.clientRef,
    code,
    latestClientId: applicationID,
  });
  await saveSeries(series, session);

  return applicationID;
};

const submitApplicationWithAudit = withAudit(
  submitApplication,
  auditDataBuilder,
);

export const submitApplicationUseCase = async (code, submission) => {
  logger.info(`Start: Application submitted for code ${code}`);

  await withTransaction(async (session) =>
    submitApplicationWithAudit({ code, submission }, session),
  );

  logger.info(`Finished: Application submitted for code ${code}`);
};
