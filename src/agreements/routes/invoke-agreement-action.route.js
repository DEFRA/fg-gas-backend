import {
  invokeAgreementActionParamsSchema,
  invokeAgreementActionPayloadSchema,
} from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { invokeAgreementActionResponseSchema } from "../schemas/responses/invoke-agreement-action-response.schema.js";
import { invokeAgreementActionUseCase } from "../use-cases/invoke-agreement-action.use-case.js";

export const invokeAgreementActionRoute = {
  method: "POST",
  path: "/agreements/{agreementNumber}/actions/{actionName}",
  options: {
    description: "Validate an Agreement lifecycle action",
    tags: ["api"],
    validate: {
      params: invokeAgreementActionParamsSchema,
      payload: invokeAgreementActionPayloadSchema,
    },
    response: {
      schema: invokeAgreementActionResponseSchema,
    },
  },
  async handler(request, _h) {
    return invokeAgreementActionUseCase({
      agreementNumber: request.params.agreementNumber,
      actionName: request.params.actionName,
      payload: request.payload,
    });
  },
};
