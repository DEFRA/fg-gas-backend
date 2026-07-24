import { agreementPresentationQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementNumberParamsSchema } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { toEtag } from "../use-cases/agreement-etag.js";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";

export const getAgreementByNumberRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}",
  options: {
    description: "Get the current page model for an Agreement number",
    tags: ["api"],
    validate: {
      params: agreementNumberParamsSchema,
      query: agreementPresentationQuerySchema,
    },
    response: { schema: agreementPageModelResponseSchema },
  },
  async handler(request, h) {
    const { agreement, pageModel } = await getCurrentAgreementPageModelUseCase({
      agreementNumber: request.params.agreementNumber,
      mode: request.query.mode,
    });

    return h.response(pageModel).header("ETag", toEtag(agreement));
  },
};
