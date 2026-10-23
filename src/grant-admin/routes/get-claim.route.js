import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { listEntitlementsWithClaimCapacity } from "../../grants/services/claims.service.js";
import {
  getApplicationClaimsOverview,
  getEntitlementCreationDetails,
} from "../../grants/services/entitlement.service.js";
import { code as grantCode } from "../schemas/code.js";
import { getClaimResponseSchema } from "../schemas/get-claim-response.schema.js";
import { buildBanner } from "../services/build-banner.js";
import { prefetchOperatorRoles } from "../services/operator-roles.js";
import { buildClaimView } from "../view-models/build-claims-view.js";

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

    const findHeldRoles = prefetchOperatorRoles();
    const [overview, creationDetails, claimableEntitlements] =
      await Promise.all([
        getApplicationClaimsOverview({ code, clientRef, findHeldRoles }),
        getEntitlementCreationDetails({
          code,
          clientRef,
          claimCode,
          findHeldRoles,
        }),
        listEntitlementsWithClaimCapacity({ code, clientRef }),
      ]);

    return buildClaimView({
      ...overview,
      banner: await buildBanner(overview),
      claimableEntitlements,
      creationDetails,
    });
  },
};
