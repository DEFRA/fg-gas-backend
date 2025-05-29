import Boom from "@hapi/boom";
import { findByCode } from "../repositories/grant.repository.js";

export const findGrantByCodeUseCase = async (code) => {
  const grant = await findByCode(code);

  if (!grant) {
    throw Boom.notFound(`Grant with code ${code} not found`);
  }

  return grant;
};
