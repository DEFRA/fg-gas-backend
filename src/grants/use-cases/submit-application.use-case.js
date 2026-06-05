import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { createAuditCallback } from "../../common/write-audit-event.js";
import { ApplicationSeries } from "../models/application-series.js";
import { save as saveSeries } from "../repositories/application-series.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";

export const submitApplicationUseCase = async (code, submission) => {
  const { clientRef } = submission.metadata;
  logger.info(`Application submitted for code ${code}`);

  await withTransaction(
    async (session) => {
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
    },
    createAuditCallback({
      entities: [
        {
          entity: auditEntities.ENTITY_APPLICATION,
          action: auditActions.ACTION_SUBMIT_APPLICATION,
          entityid: clientRef,
        },
      ],
      details: { code },
      messageGroupId: `${clientRef}-${code}`,
    }),
  );

  logger.info(`Finished: Application submitted for code ${code}`);
};
