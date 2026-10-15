import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import {
  listEntitlementsWithClaimCapacity,
  listSubmittedClaims,
} from "../../grants/services/claims.service.js";
import { getEntitlementOverview } from "../../grants/services/entitlement.service.js";
import { listClaimPaymentsUseCase } from "../../payments/use-cases/list-claim-payments.use-case.js";
import { code as grantCode } from "../schemas/code.js";
import { getClaimsResponseSchema } from "../schemas/get-claims-response.schema.js";
import { buildClaimsView } from "../services/build-claims-view.js";
import {
  assertNotHidden,
  resolveClaimsAccess,
} from "../services/claims-access.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";

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
      schema: getClaimsResponseSchema,
    },
  },
  async handler(request) {
    const { code, clientRef } = request.params;
    logger.info(
      `Get claims and entitlements for application with  code ${code} and clientRef ${clientRef}`,
    );

    const findHeldRoles = prefetchOperatorRoles();
    const [overview, claimableEntitlements, claims, claimPayments] =
      await Promise.all([
        getEntitlementOverview({ code, clientRef }),
        listEntitlementsWithClaimCapacity({ code, clientRef }),
        listSubmittedClaims({ code, clientRef }),
        listClaimPaymentsUseCase({ code, clientRef }),
      ]);

    const access = await resolveClaimsAccess(
      overview.claimsRequiredRoles,
      findHeldRoles,
    );
    assertNotHidden(access);

    return buildClaimsView({
      ...overview,
      access,
      claimableEntitlements,
      claims,
      claimPayments,
    });
  },
};
