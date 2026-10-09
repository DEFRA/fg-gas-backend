import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import {
  getChangeableEntitlement,
  listEntitlementsWithClaimCapacity,
  listSubmittedClaims,
} from "../../grants/services/claims.service.js";
import {
  getEntitlementOverview,
  getEntitlementTemplateDetails,
} from "../../grants/services/entitlement.service.js";
import { listClaimPaymentsUseCase } from "../../payments/use-cases/list-claim-payments.use-case.js";
import { claimsHeadersSchema } from "../schemas/actor-header.schema.js";
import { code as grantCode } from "../schemas/code.js";
import { getEntitlementResponseSchema } from "../schemas/get-entitlement-response.schema.js";
import { buildEntitlementView } from "../services/build-claims-view.js";
import {
  assertNotHidden,
  resolveClaimsAccess,
  userRolesOf,
} from "../services/claims-access.js";

export const getEntitlementRoute = {
  method: "GET",
  path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}",
  options: {
    description:
      "Admin: get claims data, an entitlement awaiting a claim and the template it was made under",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code: grantCode,
        clientRef: applicationClientRef,
        entitlementId: Joi.string().required(),
      }),
      headers: claimsHeadersSchema,
    },
    response: {
      schema: getEntitlementResponseSchema,
    },
  },
  async handler(request) {
    const { code, clientRef, entitlementId } = request.params;
    logger.info(
      `Get entitlement ${entitlementId} for application with code ${code} and clientRef ${clientRef}`,
    );

    const [
      overview,
      entitlementTemplate,
      claimableEntitlements,
      claimableEntitlement,
      claims,
      claimPayments,
    ] = await Promise.all([
      getEntitlementOverview({ code, clientRef }),
      getEntitlementTemplateDetails({ code, clientRef, entitlementId }),
      listEntitlementsWithClaimCapacity({ code, clientRef }),
      getChangeableEntitlement({ code, clientRef, entitlementId }),
      listSubmittedClaims({ code, clientRef }),
      listClaimPaymentsUseCase({ code, clientRef }),
    ]);

    const heldRoles = userRolesOf(request);
    const access = resolveClaimsAccess(heldRoles, overview.claimsRequiredRoles);
    assertNotHidden(access);

    return buildEntitlementView({
      ...overview,
      claimableEntitlements,
      claims,
      claimPayments,
      claimableEntitlement,
      entitlementTemplate,
    });
  },
};
