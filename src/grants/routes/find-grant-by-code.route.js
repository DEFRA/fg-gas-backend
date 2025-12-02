import Joi from "joi";
import { logger } from "../../common/logger.js";
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
    logger.info(`Finding grant with code ${request.params.code}`);
    const grant = await findGrantByCodeUseCase(request.params.code);
    logger.info(`Finished: Finding grant with code ${request.params.code}`);
    return grant;
  },
};
