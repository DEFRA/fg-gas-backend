import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { Grant } from "../models/grant.js";
import { findByCode, replace } from "../repositories/grant.repository.js";

export const replaceGrantUseCase = async (code, replaceGrantCommand) => {
  logger.info(`Replacing grant with code ${code}`);

  const version = replaceGrantCommand.version ?? "0.0.0";
  const existing = await findByCode(code, version);
  if (!existing) {
    throw Boom.notFound(
      `Grant with code "${code}" version "${version}" not found`,
    );
  }

  const grant = new Grant({
    code,
    version,
    metadata: {
      description: replaceGrantCommand.metadata.description,
      startDate: replaceGrantCommand.metadata.startDate,
    },
    actions: replaceGrantCommand.actions,
    phases: replaceGrantCommand.phases,
    externalStatusMap: replaceGrantCommand.externalStatusMap,
  });

  await replace(grant);

  logger.info(`Finished: Replacing grant with code ${code}`);
};
