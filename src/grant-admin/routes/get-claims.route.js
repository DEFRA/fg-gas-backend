import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { listClaimableEntitlements } from "../../grants/services/claims.service.js";
import { getEntitlementOverview } from "../../grants/services/entitlement.service.js";
import { code as grantCode } from "../schemas/code.js";
import { getClaimsResponseSchema } from "../schemas/get-claims-response.schema.js";
import { buildClaimsView } from "../services/build-claims-view.js";

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

    const [overview, claimableEntitlements] = await Promise.all([
      getEntitlementOverview({ code, clientRef }),
      listClaimableEntitlements({ code, clientRef }),
    ]);

    return buildClaimsView({ ...overview, claimableEntitlements });
  },
};
