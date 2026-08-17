import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef } from "../../common/schemas/client-ref.js";
import { code } from "../schemas/grant/code.js";
import { entitlementTemplates } from "../schemas/grant/entitlement-template.js";
import { findAvailableEntitlementTemplatesUseCase } from "../use-cases/find-available-entitements.use-case.js";

export const getAvailableEntitlementsRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/available-entitlements",
  options: {
    description: "Admin: get available entitlements",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
        clientRef,
      }),
    },
    response: {
      schema: Joi.object({
        entitlementTemplates,
      }),
    },
  },
  async handler(request) {
    const { code, clientRef } = request.params;
    logger.info(
      `Get available entitlements for application with  code ${code} and clientRef ${clientRef}`,
    );

    const templates = await findAvailableEntitlementTemplatesUseCase({
      code,
      clientRef,
    });

    return templates;
  },
};
