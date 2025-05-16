import * as grantRepository from "../grant-repository.js";
import { Grant } from "../grant.js";

export const createGrantUseCase = async (createGrantCommand) => {
  const grant = new Grant(createGrantCommand);

  await grantRepository.add(grant);

  return grant;
};
