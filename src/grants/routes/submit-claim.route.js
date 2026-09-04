import Joi from "joi";
import { logger } from "../../common/logger.js";
import { clientRef as applicationClientRef } from "../../common/schemas/client-ref.js";
import { code as grantCode } from "../schemas/grant/code.js";
import { submitClaimRequestSchema } from "../schemas/requests/submit-claim-request.schema.js";
import { submitClaimResponseSchema } from "../schemas/responses/submit-claim-response.schema.js";
import { submitClaim } from "../services/claims.service.js";

const statusCodes = {
  ok: 200,
  created: 201,
};

export const submitClaimRoute = {
  method: "POST",
  path: "/grants/{grantCode}/applications/{clientRef}/claims",
  options: {
    description: "Submit a claim for an application",
    tags: ["api"],
    validate: {
      payload: submitClaimRequestSchema,
      params: Joi.object({
        grantCode,
        clientRef: applicationClientRef,
      }),
    },
    response: {
      status: {
        201: submitClaimResponseSchema,
      },
    },
  },
  async handler(request, h) {
    const { grantCode: code, clientRef } = request.params;

    logger.info(
      `Submitting claim for grant ${code} and clientRef ${clientRef}`,
    );

    const result = await submitClaim({
      code,
      clientRef,
      payload: request.payload,
    });

    logger.info(
      `Finished: Submitting claim for grant ${code} and clientRef ${clientRef}`,
    );

    if (!result?.created) {
      return h.response().code(statusCodes.ok);
    }

    return h.response({ claimId: result.claimId }).code(statusCodes.created);
  },
};
