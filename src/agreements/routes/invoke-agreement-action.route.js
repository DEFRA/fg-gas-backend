import {
  invokeAgreementActionHeadersSchema,
  invokeAgreementActionParamsSchema,
  invokeAgreementActionPayloadSchema,
} from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { invokeAgreementActionResponseSchema } from "../schemas/responses/invoke-agreement-action-response.schema.js";
import { executeAgreementActionUseCase } from "../use-cases/execute-agreement-action.use-case.js";

const SEE_OTHER_STATUS_CODE = 303;
const UNPROCESSABLE_CONTENT_STATUS_CODE = 422;

export const invokeAgreementActionRoute = {
  method: "POST",
  path: "/agreements/{agreementNumber}/actions/{actionName}",
  options: {
    description: "Execute an Agreement lifecycle action",
    tags: ["api"],
    validate: {
      headers: invokeAgreementActionHeadersSchema,
      params: invokeAgreementActionParamsSchema,
      payload: invokeAgreementActionPayloadSchema,
    },
    response: {
      status: {
        [UNPROCESSABLE_CONTENT_STATUS_CODE]:
          invokeAgreementActionResponseSchema,
      },
    },
  },
  async handler(request, h) {
    const result = await executeAgreementActionUseCase({
      actionName: request.params.actionName,
      reference: {
        agreementNumber: request.params.agreementNumber,
        ...request.payload.reference,
      },
      values: request.payload.values,
      ifMatch: request.headers["if-match"],
      idempotencyKey: request.headers["idempotency-key"],
    });

    if (result.errors) {
      return h.response(result).code(UNPROCESSABLE_CONTENT_STATUS_CODE);
    }

    return h.redirect(result.location).code(SEE_OTHER_STATUS_CODE);
  },
};
