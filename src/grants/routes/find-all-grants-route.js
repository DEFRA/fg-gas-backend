import Joi from "joi";
import { findGrantResponse } from "../schemas/responses/find-grant-reponse.js";
import { findAllGrantsUseCase } from "../use-cases/find-grants-use-case.js";

export const findAllGrantsRoute = {
  method: "GET",
  path: "/grants",
  options: {
    description: "Find all grants",
    tags: ["api"],
    response: {
      schema: Joi.array().items(findGrantResponse).label("FindGrantsResponse"),
    },
  },
  async handler(_request, _h) {
    const grants = await findAllGrantsUseCase();

    return grants;
  },
};
