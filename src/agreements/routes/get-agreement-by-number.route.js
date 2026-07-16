import { getCurrentAgreementQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementNumberParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";

export const getAgreementByNumberRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}",
  options: {
    description: "Get the current page model for an Agreement number",
    tags: ["api"],
    validate: {
      params: agreementNumberParamsSchema,
      query: getCurrentAgreementQuerySchema,
    },
    response: {
      schema: agreementPageModelResponseSchema,
    },
  },
  async handler(request, _h) {
    return getCurrentAgreementPageModelUseCase({
      agreementNumber: request.params.agreementNumber,
      code: request.query.code,
      clientRef: request.query.clientRef,
      sbi: request.query.sbi,
      mode: request.query.mode,
    });
  },
};
