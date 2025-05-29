import Joi from "joi";
import { code } from "../schemas/grant/code.js";
import { findGrantResponseSchema } from "../schemas/responses/find-grant-response.schema.js";
import { findGrantByCodeUseCase } from "../use-cases/find-grant-by-code.use-case.js";

export const findGrantByCodeRoute = {
  method: "GET",
  path: "/grants/{code}",
  options: {
    description: "Find grant by code",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
      }),
    },
    response: {
      schema: findGrantResponseSchema,
    },
  },
  async handler(request, _h) {
    const grant = await findGrantByCodeUseCase(request.params.code);

    return grant;
  },
};
