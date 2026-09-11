import { testAgreementResponseSchema } from "../schemas/responses/test-agreement-response.schema.js";
import { toTestAgreementResponse } from "../services/to-test-agreement-response.js";
import { createTestAgreementPayloadSchema } from "../schemas/requests/create-test-agreement-request.schema.js";
import { createTestAgreementUseCase } from "../use-cases/create-test-agreement.use-case.js";

const CREATED = 201;

export const createTestAgreementRoute = {
  method: "POST",
  path: "/api/test/agreements",
  options: {
    description: "Create a GAS-managed Agreement (test endpoint)",
    notes:
      "QA-only endpoint, registered only when ENABLE_TEST_ENDPOINTS is true. Creates an Agreement through the same domain behaviour as normal GAS processing.",
    tags: ["api", "test"],
    auth: false,
    validate: {
      payload: createTestAgreementPayloadSchema,
    },
    response: {
      status: {
        [CREATED]: testAgreementResponseSchema,
      },
    },
  },
  async handler(request, h) {
    const agreement = await createTestAgreementUseCase(request.payload);

    return h
      .response({
        message: "Test agreement created",
        agreementData: toTestAgreementResponse(agreement),
      })
      .code(CREATED);
  },
};
