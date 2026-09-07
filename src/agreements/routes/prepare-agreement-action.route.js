import { agreementAccessHeadersSchema } from "../schemas/requests/agreement-access-headers.schema.js";
import { invokeAgreementActionParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { prepareAgreementActionUseCase } from "../use-cases/prepare-agreement-action.use-case.js";
import { resolveAgreementAccess } from "../services/resolve-agreement-access.js";

export const prepareAgreementActionRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}/actions/{actionName}",
  options: {
    description: "Prepare an Agreement lifecycle action",
    tags: ["api"],
    validate: {
      headers: agreementAccessHeadersSchema,
      params: invokeAgreementActionParamsSchema,
    },
    response: {
      schema: agreementPageModelResponseSchema,
    },
  },
  async handler(request, h) {
    const { source, code, sbi } = resolveAgreementAccess(request);
    const { pageModel, etag } = await prepareAgreementActionUseCase({
      actionName: request.params.actionName,
      agreementNumber: request.params.agreementNumber,
      access: { source, code, sbi },
    });

    return h.response(pageModel).header("ETag", etag);
  },
};
