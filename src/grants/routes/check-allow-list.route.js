import Boom from "@hapi/boom";
import {
  checkAllowListQuerySchema,
  checkAllowListRequestSchema,
} from "../schemas/requests/check-allow-list-request.schema.js";
import { checkAllowListResponseSchema } from "../schemas/responses/check-allow-list-response.schema.js";
import { checkGrantAllowListUseCase } from "../use-cases/check-grant-allow-list.use-case.js";

const base = "/api/allow-list/grants/{grantCode}";

// Hapi routes cannot represent an empty parameter in the canonical URI.
// Recognise omitted-identifier shapes only within this API's prefix.
const isOmittedIdentifier = (remainder = "") =>
  remainder === "" ||
  /^sbi(?:\/[^/]*)?(?:\/crn(?:\/[^/]*)?)?$/.test(remainder) ||
  /^crn(?:\/[^/]*)?$/.test(remainder);

export const checkAllowListRoute = {
  method: "GET",
  path: `${base}/sbi/{sbi}/crn/{crn}`,
  options: {
    description:
      "Check whether applicant identifiers satisfy a grant allow list",
    tags: ["api"],
    validate: {
      params: checkAllowListRequestSchema,
      query: checkAllowListQuerySchema,
    },
    response: { schema: checkAllowListResponseSchema },
  },
  async handler(request, h) {
    const caller = request.auth.credentials.service;
    if (typeof caller !== "string" || caller.trim() === "") {
      throw Boom.unauthorized("Service identity required");
    }
    const result = await checkGrantAllowListUseCase({
      ...request.params,
      configVersion: request.query.configVersion,
      caller,
    });
    return h.response(result).header("Cache-Control", "no-store");
  },
};

export const missingAllowListIdentifiersRoute = {
  method: "GET",
  path: `${base}/{remainder*}`,
  handler(request) {
    if (isOmittedIdentifier(request.params.remainder)) {
      throw Boom.badRequest("Both SBI and CRN are required");
    }
    throw Boom.notFound();
  },
};
