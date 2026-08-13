import { agreementAccessHeadersSchema } from "../schemas/requests/agreement-access-headers.schema.js";
import { getAgreementDocumentQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementNumberParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { getAgreementDocumentPageModelUseCase } from "../use-cases/get-agreement-document-page-model.use-case.js";

export const getAgreementByNumberRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}/document",
  options: {
    description: "Get the canonical document for an Agreement number",
    tags: ["api"],
    validate: {
      headers: agreementAccessHeadersSchema,
      params: agreementNumberParamsSchema,
      query: getAgreementDocumentQuerySchema,
    },
    response: { schema: agreementPageModelResponseSchema },
  },
  async handler(request, h) {
    const { pageModel, etag } = await getAgreementDocumentPageModelUseCase({
      agreementNumber: request.params.agreementNumber,
      access: {
        source: request.headers["x-agreement-source"],
        code: request.headers["x-agreement-code"],
        sbi: request.headers["x-agreement-sbi"],
      },
    });

    return h.response(pageModel).header("ETag", etag);
  },
};
