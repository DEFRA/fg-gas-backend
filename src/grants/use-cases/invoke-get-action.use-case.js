import Boom from "@hapi/boom";
import { wreck } from "../../common/wreck.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

export const invokeGetActionUseCase = async ({ code, name }) => {
  const grant = await findGrantByCodeUseCase(code);

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
