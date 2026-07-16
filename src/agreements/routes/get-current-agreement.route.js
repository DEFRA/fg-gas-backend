import { getCurrentAgreementQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";

export const getCurrentAgreementRoute = {
  method: "GET",
  path: "/agreements/current",
  options: {
    description:
      "Get the current agreement page model by code, client reference and SBI",
    tags: ["api"],
    validate: {
      query: getCurrentAgreementQuerySchema,
    },
    response: {
      schema: agreementPageModelResponseSchema,
    },
  },
  async handler(request, _h) {
    const { code, clientRef, sbi } = request.query;

    return getCurrentAgreementPageModelUseCase({ code, clientRef, sbi });
  },
};
