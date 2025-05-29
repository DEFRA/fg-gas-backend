import { createGrantRequestSchema } from "../schemas/requests/create-grant-request.schema.js";
import { createGrantUseCase } from "../use-cases/create-grant.use-case.js";

export const createGrantRoute = {
  method: "POST",
  path: "/grants",
  options: {
    description: "Create a grant",
    tags: ["api"],
    validate: {
      payload: createGrantRequestSchema,
    },
  },
  async handler(request, h) {
    await createGrantUseCase(request.payload);

    return h.response().code(204);
  },
};
