import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { code as grantCode } from "../schemas/grant/code.js";
import { availableClaimsResponseSchema } from "../schemas/responses/available-claims-response.schema.js";
import { findAvailableClaimsUseCase } from "../use-cases/find-available-claims.use-case.js";

export const getAvailableClaimsRoute = {
  method: "GET",
  path: "/grants/{grantCode}/entitlements/{clientRef}/available-claims",
  options: {
    description: "Get available claims for grant entitlements",
    tags: ["api"],
    validate: {
      params: Joi.object({
        grantCode,
        clientRef: applicationClientRef,
      }),
    },
    response: {
      schema: availableClaimsResponseSchema,
    },
  },
  async handler(request) {
    const { grantCode: code, clientRef } = request.params;
    logger.info(
      `Get available claims for grant ${code} and clientRef ${clientRef}`,
    );

    const result = await findAvailableClaimsUseCase({ code, clientRef });

    return result;
  },
};
