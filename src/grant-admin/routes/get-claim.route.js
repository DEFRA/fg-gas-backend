import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import {
  getEntitlementCreationDetails,
  getEntitlementOverview,
} from "../../grants/services/entitlement.service.js";
import { code as grantCode } from "../schemas/code.js";
import { getClaimResponseSchema } from "../schemas/get-claim-response.schema.js";
import {
  buildClaimsView,
  toEntitlementTemplate,
} from "../services/build-claims-view.js";

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

    const [overview, creationDetails] = await Promise.all([
      getEntitlementOverview({ code, clientRef }),
      getEntitlementCreationDetails({ code, clientRef, claimCode }),
    ]);

    return {
      ...(await buildClaimsView(overview)),
      entitlementTemplate: toEntitlementTemplate(creationDetails),
    };
  },
};
