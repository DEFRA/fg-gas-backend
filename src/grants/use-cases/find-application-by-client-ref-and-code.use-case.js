import Boom from "@hapi/boom";
import { findByClientRefAndCode } from "../repositories/application.repository.js";

export const findApplicationByClientRefAndCodeUseCase = async (
  clientRef,
  code,
) => {
  const application = await findByClientRefAndCode({
    clientRef,
    code,
  });

  if (application === null) {
    throw Boom.notFound(
      `Application with clientRef "${clientRef}" and code "${code}" not found`,
    );
  }

  return application;
};
