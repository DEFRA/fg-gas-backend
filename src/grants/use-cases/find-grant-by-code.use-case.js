import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { findByCode } from "../repositories/grant.repository.js";

export const findGrantByCodeUseCase = async (code) => {
  logger.debug(`Finding grant by code ${code}`);
  const grant = await findByCode(code);

  if (!grant) {
    throw Boom.notFound(`Grant with code ${code} not found`);
  }

  logger.debug(`Finished:: Finding grant by code ${code}`);

  return grant;
};
