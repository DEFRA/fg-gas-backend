import { invokeAgreementActionParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { prepareAgreementActionQuerySchema } from "../schemas/requests/prepare-agreement-action-query.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { prepareAgreementActionUseCase } from "../use-cases/prepare-agreement-action.use-case.js";

export const prepareAgreementActionRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}/actions/{actionName}",
  options: {
    description: "Prepare an Agreement lifecycle action",
    tags: ["api"],
    validate: {
      params: invokeAgreementActionParamsSchema,
      query: prepareAgreementActionQuerySchema,
    },
    response: {
      schema: agreementPageModelResponseSchema,
    },
  },
  async handler(request, _h) {
    return prepareAgreementActionUseCase({
      actionName: request.params.actionName,
      agreementNumber: request.params.agreementNumber,
      code: request.query.code,
      clientRef: request.query.clientRef,
      sbi: request.query.sbi,
    });
  },
};
