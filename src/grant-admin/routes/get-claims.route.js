import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { entitlementTemplates } from "../../grants/schemas/grant/entitlement-template.js";
import { code as grantCode } from "../schemas/code.js";
import { findClaimsUseCase } from "../use-cases/find-claims.use-case.js";

export const getClaimsRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims",
  options: {
    description: "Admin: get available claims data",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code: grantCode,
        clientRef: applicationClientRef,
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
