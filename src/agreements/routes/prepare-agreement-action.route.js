import { invokeAgreementActionParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { toEtag } from "../use-cases/agreement-etag.js";
import { prepareAgreementActionUseCase } from "../use-cases/prepare-agreement-action.use-case.js";

export const prepareAgreementActionRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}/actions/{actionName}",
  options: {
    description: "Prepare an Agreement lifecycle action",
    tags: ["api"],
    validate: {
      params: invokeAgreementActionParamsSchema,
    },
    response: {
      schema: agreementPageModelResponseSchema,
    },
  },
  async handler(request, h) {
    const pageModel = await prepareAgreementActionUseCase({
      actionName: request.params.actionName,
      agreementNumber: request.params.agreementNumber,
    });
    const agreement = pageModel.agreement;

    return h.response(pageModel).header("ETag", toEtag(agreement));
  },
};
