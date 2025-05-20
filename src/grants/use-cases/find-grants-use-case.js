import { findAll } from "../repositories/grant-repository.js";

export const findAllGrantsUseCase = async () => {
  return await findAll();
};
