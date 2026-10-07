import { lockForUpdate } from "../repositories/application.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import { applicationNotFound } from "./entitlement-errors.js";

const httpNotFound = 404;

export const mapApplicationNotFound = async (command) => {
  try {
    return await findApplicationByClientRefAndCodeUseCase(
      command.clientRef,
      command.code,
    );
  } catch (error) {
    if (error.isBoom && error.output.statusCode === httpNotFound) {
      throw applicationNotFound(command);
    }

    throw error;
  }
};

export const lockApplication = async (command, session) => {
  const application = await lockForUpdate(
    { clientRef: command.clientRef, code: command.code },
    session,
  );

  if (application === null) {
    throw applicationNotFound(command);
  }

  return application;
};
