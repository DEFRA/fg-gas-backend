import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef } from "../../common/schemas/client-ref.js";
import { code } from "../schemas/grant/code.js";
import { entitlementTemplates } from "../schemas/grant/entitlement-template.js";
import { findClaimsUseCase } from "../use-cases/find-claims.use-case.js";

export const getClaimsRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims",
  options: {
    description: "Admin: get available claims data",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
        clientRef,
      }),
    },
    response: {
      // claimableEntitlements and claims are stubbed as empty by the use case
      // until entitlement instances are written, so neither has a shape to
      // pin down yet.
      schema: Joi.object({
        availableEntitlements: entitlementTemplates,
        claimableEntitlements: Joi.array(),
        claims: Joi.array(),
      }),
    },
  },
  async handler(request) {
    const { code, clientRef } = request.params;
    logger.info(
      `Get claims and entitlements for application with  code ${code} and clientRef ${clientRef}`,
    );

    const templates = await findClaimsUseCase({
      code,
      clientRef,
    });

    return templates;
  },
};
