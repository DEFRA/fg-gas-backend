import Boom from "@hapi/boom";
import { wreck } from "../../common/wreck.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";

export const invokePostActionUseCase = async ({ code, name, payload }) => {
  const grant = await findGrantByCodeUseCase(code);

  const action = grant.actions.find(
    (e) => e.method === "POST" && e.name === name,
  );

  if (!action) {
    throw Boom.badRequest(
      `Grant with code "${code}" has no POST action named "${name}"`,
    );
  }

  const response = await wreck.post(action.url, {
    payload,
    json: true,
  });

  return response.payload;
};
