import { logger } from "../../common/logger.js";
import { Grant } from "../models/grant.js";
import { save } from "../repositories/grant.repository.js";

export const createGrantUseCase = async (createGrantCommand) => {
  logger.debug(`Creating grant with code ${createGrantCommand.code}`);
  const grant = new Grant({
    code: createGrantCommand.code,
    metadata: {
      description: createGrantCommand.metadata.description,
      startDate: createGrantCommand.metadata.startDate,
    },
    actions: createGrantCommand.actions.map((e) => ({
      name: e.name,
      method: e.method,
      url: e.url,
    })),
    phases: createGrantCommand.phases,
    externalStatusMap: createGrantCommand.externalStatusMap,
  });

  await save(grant);

  logger.debug(`Finished: Created grant with code ${createGrantCommand.code}`);

  return grant;
};
