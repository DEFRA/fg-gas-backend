import Joi from "joi";
import { code } from "../schemas/grant/code.js";
import { findGrantResponse } from "../schemas/responses/find-grant-reponse.js";
import { findByCodeUseCase } from "../use-cases/find-by-code-use-case.js";

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
      schema: findGrantResponse,
    },
  },
  async handler(request, _h) {
    const grant = await findByCodeUseCase(request.params.code);

    return {
      code: grant.code,
      metadata: {
        description: grant.metadata.description,
        startDate: grant.metadata.startDate,
      },
      actions: grant.actions,
      questions: grant.questions,
    };
  },
};
