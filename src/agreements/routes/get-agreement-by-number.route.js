import { getAgreementDocumentQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementNumberParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { toEtag } from "../use-cases/agreement-etag.js";
import { getAgreementDocumentPageModelUseCase } from "../use-cases/get-agreement-document-page-model.use-case.js";

export const getAgreementByNumberRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}/document",
  options: {
    description: "Get the canonical document for an Agreement number",
    tags: ["api"],
    validate: {
      params: agreementNumberParamsSchema,
      query: getAgreementDocumentQuerySchema,
    },
    response: { schema: agreementPageModelResponseSchema },
  },
  async handler(request, h) {
    const { code, clientRef, sbi } = request.query;
    const { agreement, pageModel } = await getAgreementDocumentPageModelUseCase(
      {
        agreementNumber: request.params.agreementNumber,
        code,
        clientRef,
        sbi,
      },
    );

    return h.response(pageModel).header("ETag", toEtag(agreement));
  },
};
