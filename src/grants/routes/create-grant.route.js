import { logger } from "../../common/logger.js";
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
    logger.info(`Creating grant for code ${request.payload.code}`);
    await createGrantUseCase(request.payload);
    logger.info(`Finished: Creating grant for code ${request.payload.code}`);
    return h.response().code(204);
  },
};
