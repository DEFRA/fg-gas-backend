import Boom from "@hapi/boom";
import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { code as grantCode } from "../schemas/code.js";
import { createEntitlementRequestSchema } from "../schemas/create-entitlement-request.schema.js";
import { createEntitlementUseCase } from "../use-cases/create-entitlement.use-case.js";

const HTTP_STATUS_CREATED = 201;

export const createEntitlementRoute = {
  method: "POST",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements",
  options: {
    description: "Admin: create an entitlement for a claim code",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code: grantCode,
        clientRef: applicationClientRef,
      }),
      payload: createEntitlementRequestSchema,
    },
  },
  async handler(request, h) {
    const { code, clientRef } = request.params;
    const { grantCode: payloadCode, ...payload } = request.payload;

    if (payload.clientRef !== clientRef || payloadCode !== code) {
      throw Boom.badRequest(
        "Payload clientRef and grantCode must match the URL",
      );
    }

    logger.info(
      `Create entitlement for application with code ${code}, claimCode ${payload.claimCode} and clientRef ${clientRef}`,
    );

    const entitlement = await createEntitlementUseCase({
      code,
      clientRef,
      claimCode: payload.claimCode,
      data: payload.data,
    });

    return h.response(entitlement).code(HTTP_STATUS_CREATED);
  },
};
