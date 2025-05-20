import { add } from "../repositories/grant-repository.js";
import { Grant } from "../models/grant.js";

export const createGrantUseCase = async (createGrantCommand) => {
  const grant = new Grant(createGrantCommand);

  await add(grant);

  return grant;
};
