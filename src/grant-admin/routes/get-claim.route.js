import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { listEntitlementsWithClaimCapacity } from "../../grants/services/claims.service.js";
import {
  getEntitlementCreationDetails,
  getEntitlementOverview,
} from "../../grants/services/entitlement.service.js";
import { claimsHeadersSchema } from "../schemas/actor-header.schema.js";
import { code as grantCode } from "../schemas/code.js";
import { getClaimResponseSchema } from "../schemas/get-claim-response.schema.js";
import { buildClaimView } from "../services/build-claims-view.js";
import {
  assertFullAccess,
  resolveClaimsAccess,
  userRolesOf,
} from "../services/claims-access.js";

export const getClaimRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/{claimCode}",
  options: {
    description: "Admin: get claims data and the template for a claim code",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code: grantCode,
        clientRef: applicationClientRef,
        claimCode: Joi.string().required(),
      }),
      headers: claimsHeadersSchema,
    },
    response: {
      schema: getClaimResponseSchema,
    },
  },
  async handler(request) {
    const { code, clientRef, claimCode } = request.params;
    logger.info(
      `Get claim for application with code ${code}, claimCode ${claimCode} and clientRef ${clientRef}`,
    );

    const [overview, creationDetails, claimableEntitlements] =
      await Promise.all([
        getEntitlementOverview({ code, clientRef }),
        getEntitlementCreationDetails({ code, clientRef, claimCode }),
        listEntitlementsWithClaimCapacity({ code, clientRef }),
      ]);

    const heldRoles = userRolesOf(request);
    const access = resolveClaimsAccess(heldRoles, overview.claimsRequiredRoles);
    assertFullAccess(access);

    return buildClaimView({
      ...overview,
      claimableEntitlements,
      creationDetails,
    });
  },
};
