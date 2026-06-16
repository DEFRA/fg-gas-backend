import {
  auditActions,
  auditEntities,
  buildAuditEvent,
} from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { withAudit } from "../../common/with-audit.js";
import { ApplicationSeries } from "../models/application-series.js";
import { save as saveSeries } from "../repositories/application-series.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";

const submitApplication = async (session, code, submission) => {
  logger.info(`Application submitted for code ${code}`);

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

  logger.info(`Finished: Application submitted for code ${code}`);
};

export const submitApplicationUseCase = withAudit({
  transactional: true,
  run: submitApplication,
  audit: ({ args }) => {
    const [code, submission] = args;
    const { clientRef } = submission.metadata;
    return buildAuditEvent({
      entity: auditEntities.APPLICATION,
      action: auditActions.SUBMIT_APPLICATION,
      entityid: clientRef,
      details: { code },
      messageGroupId: `${clientRef}-${code}`,
    });
  },
});
