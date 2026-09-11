import {
  updateTestAgreementStatusParamsSchema,
  updateTestAgreementStatusPayloadSchema,
} from "../schemas/requests/update-test-agreement-status-request.schema.js";
import { testAgreementResponseSchema } from "../schemas/responses/test-agreement-response.schema.js";
import { toTestAgreementResponse } from "../services/to-test-agreement-response.js";
import { updateTestAgreementStatusUseCase } from "../use-cases/update-test-agreement-status.use-case.js";

const OK = 200;

export const updateTestAgreementStatusRoute = {
  method: "POST",
  path: "/api/test/agreements/{agreementNumber}/status",
  options: {
    description: "Apply an Agreement status transition (test endpoint)",
    notes:
      "QA-only endpoint, registered only when ENABLE_TEST_ENDPOINTS is true. Applies withdrawn, cancelled or terminated through the same domain behaviour as normal GAS processing. Transitions that are not valid from the current state are rejected with 409.",
    tags: ["api", "test"],
    auth: false,
    validate: {
      params: updateTestAgreementStatusParamsSchema,
      payload: updateTestAgreementStatusPayloadSchema,
    },
    response: {
      status: {
        [OK]: testAgreementResponseSchema,
      },
    },
  },
  async handler(request) {
    const agreement = await updateTestAgreementStatusUseCase({
      agreementNumber: request.params.agreementNumber,
      status: request.payload.status,
    });

    return {
      message: "Test agreement status updated",
      agreementData: toTestAgreementResponse(agreement),
    };
  },
};
