import {
  invokeAgreementActionParamsSchema,
  invokeAgreementActionPayloadSchema,
} from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { invokeAgreementActionResponseSchema } from "../schemas/responses/invoke-agreement-action-response.schema.js";
import { validateAgreementActionUseCase } from "../use-cases/validate-agreement-action.use-case.js";

const UNPROCESSABLE_CONTENT_STATUS_CODE = 422;

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
  async handler(request, h) {
    const result = await validateAgreementActionUseCase({
      actionName: request.params.actionName,
      reference: {
        agreementNumber: request.params.agreementNumber,
        ...request.payload.reference,
      },
      values: request.payload.values,
    });

    return result.valid
      ? result
      : h.response(result).code(UNPROCESSABLE_CONTENT_STATUS_CODE);
  },
};
