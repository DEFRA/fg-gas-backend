import Boom from "@hapi/boom";
import { findByClientRef } from "../repositories/application.repository.js";

export const findApplicationByClientRefUseCase = async (clientRef) => {
  const application = await findByClientRef(clientRef);

  if (application === null) {
    throw Boom.notFound(`Application with clientRef "${clientRef}" not found`);
  }

  return application;
};
