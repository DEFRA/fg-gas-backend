import { getAgreementPageModelQuerySchema } from "../schemas/requests/get-agreement-page-model-query.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { getAgreementPageModelUseCase } from "../use-cases/get-agreement-page-model.use-case.js";

export const getAgreementPageModelRoute = {
  method: "GET",
  path: "/agreements/render",
  options: {
    description: "Get the page model for a requested agreement page/mode",
    tags: ["api"],
    validate: {
      query: getAgreementPageModelQuerySchema,
    },
    response: {
      schema: agreementPageModelResponseSchema,
    },
  },
  async handler(request, _h) {
    const { code, clientRef, sbi, page, mode } = request.query;

    return getAgreementPageModelUseCase({ code, clientRef, sbi, page, mode });
  },
};
