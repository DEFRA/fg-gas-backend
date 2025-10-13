import { Grant } from "../models/grant.js";
import { save } from "../repositories/grant.repository.js";

export const createGrantUseCase = async (createGrantCommand) => {
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
  });

  await save(grant);

  return grant;
};
