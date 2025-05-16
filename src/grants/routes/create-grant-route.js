import { createGrantRequest } from "../schemas/requests/create-grant-request.js";
import { badRequestResponse } from "../schemas/responses/bad-request-response.js";
import { createGrantUseCase } from "../use-cases/create-grant-use-case.js";

export const createGrantRoute = {
  method: "POST",
  path: "/grants",
  options: {
    description: "Create a grant",
    tags: ["api"],
    validate: {
      payload: createGrantRequest,
    },
    response: {
      status: {
        400: badRequestResponse,
      },
    },
  },
  async handler(request, h) {
    await createGrantUseCase(request.payload);

    return h.response().code(204);
  },
};
