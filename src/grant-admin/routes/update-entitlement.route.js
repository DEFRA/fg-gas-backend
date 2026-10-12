import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import {
  getEntitlementOverview,
  updateEntitlement,
} from "../../grants/services/entitlement.service.js";
import {
  actorHeaderSchema,
  claimsHeadersSchema,
} from "../schemas/actor-header.schema.js";
import { code as grantCode } from "../schemas/code.js";
import { updateEntitlementRequestSchema } from "../schemas/update-entitlement-request.schema.js";
import { decodeActor } from "../services/actor-header.js";
import {
  assertFullAccess,
  resolveClaimsAccess,
  userRolesOf,
} from "../services/claims-access.js";

// Encoded by the caller when the name has characters a header cannot carry.
const readActor = (request) => decodeActor(request.headers["x-actor"]) ?? null;

export const updateEntitlementRoute = {
  method: "PUT",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}",
  options: {
    description: "Admin: update an entitlement no claim has been made against",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code: grantCode,
        clientRef: applicationClientRef,
        entitlementId: Joi.string().required(),
      }),
      payload: updateEntitlementRequestSchema,
      headers: claimsHeadersSchema.concat(actorHeaderSchema),
    },
  },
  async handler(request) {
    const { code, clientRef, entitlementId } = request.params;

    const overview = await getEntitlementOverview({ code, clientRef });
    const heldRoles = userRolesOf(request);
    const access = resolveClaimsAccess(heldRoles, overview.claimsRequiredRoles);
    assertFullAccess(access);

    logger.info(
      `Update entitlement ${entitlementId} for application with code ${code} and clientRef ${clientRef}`,
    );

    return updateEntitlement({
      code,
      clientRef,
      entitlementId,
      data: request.payload.data,
      actor: readActor(request),
    });
  },
};
