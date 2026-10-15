import Boom from "@hapi/boom";
import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import {
  createEntitlement,
  getEntitlementOverview,
} from "../../grants/services/entitlement.service.js";
import { actorHeaderSchema } from "../schemas/actor-header.schema.js";
import { code as grantCode } from "../schemas/code.js";
import { createEntitlementRequestSchema } from "../schemas/create-entitlement-request.schema.js";
import { decodeActor } from "../services/actor-header.js";
import {
  assertFullAccess,
  resolveClaimsAccess,
} from "../services/claims-access.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";

const HTTP_STATUS_CREATED = 201;

// Encoded by the caller when the name has characters a header cannot carry.
const readActor = (request) => decodeActor(request.headers["x-actor"]) ?? null;

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
      headers: actorHeaderSchema,
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

    const findHeldRoles = prefetchOperatorRoles();
    const overview = await getEntitlementOverview({ code, clientRef });
    const access = await resolveClaimsAccess(
      overview.claimsRequiredRoles,
      findHeldRoles,
    );
    assertFullAccess(access);

    logger.info(
      `Create entitlement for application with code ${code}, claimCode ${payload.claimCode} and clientRef ${clientRef}`,
    );

    const entitlement = await createEntitlement({
      code,
      clientRef,
      claimCode: payload.claimCode,
      data: payload.data,
      actor: readActor(request),
    });

    return h.response(entitlement).code(HTTP_STATUS_CREATED);
  },
};
