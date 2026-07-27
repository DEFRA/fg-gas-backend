import { getCurrentAgreementQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { toEtag } from "../use-cases/agreement-etag.js";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";

export const getCurrentAgreementRoute = {
  method: "GET",
  path: "/agreements/current",
  options: {
    description:
      "Get the current Agreement page model by source identity and SBI account",
    tags: ["api"],
    validate: { query: getCurrentAgreementQuerySchema },
    response: { schema: agreementPageModelResponseSchema },
  },
  async handler(request, h) {
    const { code, clientRef, sbi, mode } = request.query;
    const { agreement, pageModel } = await getCurrentAgreementPageModelUseCase({
      code,
      clientRef,
      sbi,
      mode,
    });

    return h.response(pageModel).header("ETag", toEtag(agreement));
  },
};
