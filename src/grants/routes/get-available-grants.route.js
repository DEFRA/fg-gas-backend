import Boom from "@hapi/boom";
import { checkAllowListQuerySchema } from "../schemas/requests/check-allow-list-request.schema.js";
import { getAvailableGrantsRequestSchema } from "../schemas/requests/get-available-grants-request.schema.js";
import { getAvailableGrantsResponseSchema } from "../schemas/responses/get-available-grants-response.schema.js";
import { getAvailableGrantsUseCase } from "../use-cases/get-available-grants.use-case.js";

const base = "/api/allow-list/grants";

export const missingAvailableGrantsIdentifiersRoute = {
  method: "GET",
  path: base,
  options: { cache: { otherwise: "no-store" } },
  handler() {
    throw Boom.badRequest("SBI is required");
  },
};

export const getAvailableGrantsRoute = {
  method: "GET",
  path: `${base}/sbi/{sbi}`,
  options: {
    description: "Get the grant codes available to an applicant",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      params: getAvailableGrantsRequestSchema,
      query: checkAllowListQuerySchema,
    },
    response: { schema: getAvailableGrantsResponseSchema },
  },
  async handler(request, h) {
    const caller = request.auth.credentials.service;
    if (typeof caller !== "string" || caller.trim() === "") {
      throw Boom.unauthorized("Service identity required");
    }
    return h.response(
      await getAvailableGrantsUseCase({ ...request.params, caller }),
    );
  },
};
