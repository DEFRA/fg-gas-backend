import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import {
  findByClientRef,
  update,
} from "../repositories/application-x-ref.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { findApplicationByClientRefUseCase } from "./find-application-by-client-ref.use-case.js";

export const replaceApplicationUseCase = async (code, application) => {
  logger.info(`Replacing application`);

  return withTransaction(async (session) => {
    const { clientRef, previousClientRef } = application.metadata;
    logger.info(`Got previousClientRef: ${previousClientRef}.`);

    const previousAppl = await findApplicationByClientRefUseCase(
      previousClientRef,
      code,
    );

    if (previousAppl.replacementAllowed) {
      const applicationID = await createApplicationUseCase(
        code,
        application,
        session,
      );
      const xref = await findByClientRef(previousClientRef, session);
      xref.addClientRef(clientRef, applicationID);
      await update(xref, session);
      logger.info("Updated XRef table.");
    } else {
      throw Boom.conflict(
        `Can not replace existing Application with clientRef: ${previousClientRef} with new clientRef: ${clientRef} - replacement is not allowed`,
      );
    }
    logger.info("End replacing application.");
  });
};
