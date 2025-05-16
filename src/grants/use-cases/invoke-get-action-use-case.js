import Boom from "@hapi/boom";
import { wreck } from "../../common/wreck.js";
import * as grantRepository from "../grant-repository.js";

export const invokeGetActionUseCase = async ({ code, name }) => {
  const grant = await grantRepository.findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

  const action = grant.actions.find(
    (e) => e.method === "GET" && e.name === name,
  );

  if (!action) {
    throw Boom.badRequest(
      `Grant with code "${code}" has no GET action named "${name}"`,
    );
  }

  const response = await wreck.get(`${action.url}?code=${code}`, {
    json: true,
  });

  return response.payload;
};
