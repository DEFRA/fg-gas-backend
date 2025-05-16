import Boom from "@hapi/boom";
import * as applicationRepository from "./application-repository.js";

export const findApplicationByClientRef = async (clientRef) => {
  const application = await applicationRepository.findByClientRef(clientRef);

  if (application === null) {
    throw Boom.notFound(`Application with clientRef "${clientRef}" not found`);
  }

  return application;
};
