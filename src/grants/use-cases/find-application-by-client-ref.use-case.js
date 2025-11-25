import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findByClientRef } from "../repositories/application.repository.js";

export const findApplicationByClientRefUseCase = async (clientRef) => {
  logger.debug(`Finding application by clientRef ${clientRef}`);

  const application = await findByClientRef(clientRef);

  if (application === null) {
    throw Boom.notFound(`Application with clientRef "${clientRef}" not found`);
  }

  logger.debug(`Finished: Finding application by clientRef ${clientRef}`);

  return application;
};
