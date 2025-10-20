import { Grant } from "../models/grant.ts";
import { replace } from "../repositories/grant.repository.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

export const replaceGrantUseCase = async (code, replaceGrantCommand) => {
  await findGrantByCodeUseCase(code);

  const grant = new Grant({
    code,
    metadata: {
      description: replaceGrantCommand.metadata.description,
      startDate: replaceGrantCommand.metadata.startDate,
    },
    actions: replaceGrantCommand.actions,
    phases: replaceGrantCommand.phases,
  });

  await replace(grant);
};
