import { agreementAccessHeadersSchema } from "../schemas/requests/agreement-access-headers.schema.js";
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
      headers: agreementAccessHeadersSchema,
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
      access: {
        source: request.headers["x-agreement-source"],
        code: request.headers["x-agreement-code"],
        sbi: request.headers["x-agreement-sbi"],
      },
    });
    const agreement = pageModel.agreement;

    return h.response(pageModel).header("ETag", toEtag(agreement));
  },
};
