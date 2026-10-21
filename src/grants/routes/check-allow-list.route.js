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
    cache: { otherwise: "no-store" },
    validate: {
      params: checkAllowListRequestSchema,
      query: checkAllowListQuerySchema,
    },
    response: { schema: checkAllowListResponseSchema },
  },
  async handler(request, h) {
    const caller = [
      request.auth.credentials.service,
      request.auth.artifacts.client,
    ].find((value) => typeof value === "string" && value.trim() !== "");
    if (!caller) {
      throw Boom.unauthorized("Service identity required");
    }
    const result = await checkGrantAllowListUseCase({
      ...request.params,
      caller,
    });
    return h.response(result);
  },
};

export const missingAllowListIdentifiersRoute = {
  method: "GET",
  path: `${base}/{remainder*}`,
  options: {
    cache: { otherwise: "no-store" },
  },
  handler(request) {
    if (isOmittedIdentifier(request.params.remainder)) {
      throw Boom.badRequest("Both SBI and CRN are required");
    }
    throw Boom.notFound();
  },
};
