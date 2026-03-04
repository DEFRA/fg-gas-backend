import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationSeries } from "../models/application-series.js";
import { save as saveSeries } from "../repositories/application-series.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";

export const submitApplicationUseCase = async (code, submission) => {
  logger.info(`Application submitted for code ${code}`);

  await withTransaction(async (session) => {
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
  });

  logger.info(`Finished: Application submitted for code ${code}`);
};
