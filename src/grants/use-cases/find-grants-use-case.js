import * as grantRepository from "../grant-repository.js";

export const findAllGrantsUseCase = async () => {
  return grantRepository.findAll();
};
