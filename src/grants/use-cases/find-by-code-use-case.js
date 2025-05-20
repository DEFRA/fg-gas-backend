import { findByCode } from "../repositories/grant-repository.js";

export const findByCodeUseCase = async (code) => {
  const grant = await findByCode(code);

  if (!grant) {
    throw new Error(`Grant with code ${code} not found`);
  }

  return grant;
};
