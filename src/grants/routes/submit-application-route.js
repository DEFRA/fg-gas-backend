import Joi from "joi";
import { createApplicationRequest } from "../schemas/requests/create-application-request.js";
import { badRequestResponse } from "../schemas/responses/bad-request-response.js";
import { code } from "../schemas/grant/code.js";
import { submitApplicationUseCase } from "../use-cases/submit-application-use-case.js";

export const submitApplicationRoute = {
  method: "POST",
  path: "/grants/{code}/applications",
  options: {
    description: "Submit an application for a grant",
    tags: ["api"],
    validate: {
      payload: createApplicationRequest,
      params: Joi.object({
        code,
      }),
    },
    response: {
      status: {
        400: badRequestResponse,
      },
    },
  },
  async handler(request, h) {
    await submitApplicationUseCase(request.params.code, request.payload);

    return h.response(204).code(201);
  },
};
