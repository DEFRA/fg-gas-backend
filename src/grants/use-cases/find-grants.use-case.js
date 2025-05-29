import { findAll } from "../repositories/grant.repository.js";

export const findGrantsUseCase = async () => {
  return await findAll();
};
