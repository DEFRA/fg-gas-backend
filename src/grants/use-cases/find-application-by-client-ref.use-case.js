import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findByClientRef } from "../repositories/application.repository.js";

export const findApplicationByClientRefUseCase = async (clientRef) => {
  logger.info(`Finding application by clientRef ${clientRef}`);

  const application = await findByClientRef(clientRef);

  if (application === null) {
    throw Boom.notFound(`Application with clientRef "${clientRef}" not found`);
  }

  logger.info(`Finished: Finding application by clientRef ${clientRef}`);

  return application;
};
