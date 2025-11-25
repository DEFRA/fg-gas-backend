import Joi from "joi";
import { logger } from "../../common/logger.js";
import { findGrantResponseSchema } from "../schemas/responses/find-grant-response.schema.js";
import { findGrantsUseCase } from "../use-cases/find-grants.use-case.js";

export const findGrantsRoute = {
  method: "GET",
  path: "/grants",
  options: {
    description: "Find all grants",
    tags: ["api"],
    response: {
      schema: Joi.array()
        .items(findGrantResponseSchema)
        .label("FindGrantsResponse"),
    },
  },
  async handler(_request, _h) {
    logger.info("Finding all grants");
    const grants = await findGrantsUseCase();
    logger.info("Finished: Finding all grants");
    return grants;
  },
};
