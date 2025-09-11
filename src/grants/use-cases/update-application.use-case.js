import Boom from "@hapi/boom";
import { update } from "../repositories/application.repository.js";

export const updateApplicationUseCase = async (application) => {
  const updatedApplication = await update(application);

  if (!updatedApplication) {
    throw Boom.badData(
      `Application with clientRef ${application.clientRef} was not updated`,
    );
  }

  return updatedApplication;
};
