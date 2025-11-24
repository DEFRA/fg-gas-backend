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
    logger.info("Creating grant");
    await createGrantUseCase(request.payload);
    logger.info("Grant created");
    return h.response().code(204);
  },
};
