import * as grantRepository from "../grant-repository.js";

export const findByCodeUseCase = async (code) => {
  const grant = await grantRepository.findByCode(code);

  if (!grant) {
    throw new Error(`Grant with code ${code} not found`);
  }

  return grant;
};
