import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { code as grantCode } from "../schemas/grant/code.js";
import { availableClaimsResponseSchema } from "../schemas/responses/available-claims-response.schema.js";
import { listClaimableEntitlements } from "../services/claims.service.js";

// entitlementId crosses the boundary so a caller can name its target when it
// submits; instanceNumber and source stay internal.
const toAvailableClaim = ({
  code,
  entitlementId,
  name,
  description,
  data,
}) => ({
  code,
  entitlementId,
  name,
  description,
  data,
});

export const getAvailableClaimsRoute = {
  method: "GET",
  path: "/grants/{grantCode}/entitlements/{clientRef}/available-claims",
  options: {
    description: "Get available claims for grant entitlements",
    tags: ["api"],
    validate: {
      params: Joi.object({
        grantCode,
        clientRef: applicationClientRef,
      }),
    },
    response: {
      schema: availableClaimsResponseSchema,
    },
  },
  async handler(request) {
    const { grantCode: code, clientRef } = request.params;
    logger.info(
      `Get available claims for grant ${code} and clientRef ${clientRef}`,
    );

    const claimableEntitlements = await listClaimableEntitlements({
      code,
      clientRef,
    });

    return { availableClaims: claimableEntitlements.map(toAvailableClaim) };
  },
};
