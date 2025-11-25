import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";

export const findApplicationByClientRefAndCodeUseCase = async (
  clientRef,
  code,
) => {
  logger.debug(
    `Finding application by clientRef ${clientRef} and code ${code}`,
  );

  const application = await findByClientRefAndCode({
    clientRef,
    code,
  });

  if (application === null) {
    throw Boom.notFound(
      `Application with clientRef "${clientRef}" and code "${code}" not found`,
    );
  }

  logger.debug(
    `Finished: Finding application by clientRef ${clientRef} and code ${code}`,
  );
  return application;
};
