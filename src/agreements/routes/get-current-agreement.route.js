import { getCurrentAgreementQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { getCurrentAgreementPageResponseSchema } from "../schemas/responses/get-current-agreement-page-response.schema.js";
import { getCurrentAgreementPageUseCase } from "../use-cases/get-current-agreement-page.use-case.js";

export const getCurrentAgreementRoute = {
  method: "GET",
  path: "/agreements/current",
  options: {
    description: "Get the current agreement by code, client reference and SBI",
    tags: ["api"],
    validate: {
      query: getCurrentAgreementQuerySchema,
    },
    response: {
      schema: getCurrentAgreementPageResponseSchema,
    },
  },
  async handler(request, _h) {
    const { code, clientRef, sbi } = request.query;

    return getCurrentAgreementPageUseCase({ code, clientRef, sbi });
  },
};
