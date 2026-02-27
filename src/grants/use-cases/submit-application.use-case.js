import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { ApplicationXRef } from "../models/application-x-ref.js";
import { save as saveXref } from "../repositories/application-x-ref.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";

export const submitApplicationUseCase = async (code, submission) => {
  logger.info(`Application submitted for code ${code}`);

  await withTransaction(async (session) => {
    const applicationID = await createApplicationUseCase(
      code,
      submission,
      session,
    );
    const xref = ApplicationXRef.new({
      currentClientRef: submission.metadata.clientRef,
      currentClientId: applicationID,
    });
    await saveXref(xref, session);
  });

  logger.info(`Finished: Application submitted for code ${code}`);
};
