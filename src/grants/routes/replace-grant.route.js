import Joi from "joi";
import { logger } from "../../common/logger.js";
import { code } from "../schemas/grant/code.js";
import { replaceGrantRequestSchema } from "../schemas/requests/replace-grant-request.schema.js";
import { replaceGrantUseCase } from "../use-cases/replace-grant.use-case.js";

export const replaceGrantRoute = {
  method: "PUT",
  path: "/tmp/grants/{code}",
  options: {
    description: "Temporary endpoint to update a grant",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
      }),
      payload: replaceGrantRequestSchema,
    },
  },
  async handler(request, h) {
    logger.info("Replacing grant");
    await replaceGrantUseCase(request.params.code, request.payload);

    logger.info("Grant replaced");
    return h.response().code(204);
  },
};
