import Boom from "@hapi/boom";
import { wreck } from "../../common/wreck.js";
import { findByCode } from "../repositories/grant-repository.js";

export const invokePostActionUseCase = async ({ code, name, payload }) => {
  const grant = await findByCode(code);

  if (grant === null) {
    throw Boom.notFound(`Grant with code "${code}" not found`);
  }

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
