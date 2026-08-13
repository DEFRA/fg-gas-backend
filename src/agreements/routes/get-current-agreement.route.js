import { agreementIdentityHeadersSchema } from "../schemas/requests/agreement-access-headers.schema.js";
import { getCurrentAgreementQuerySchema } from "../schemas/requests/get-current-agreement-query.schema.js";
import { agreementPageModelResponseSchema } from "../schemas/responses/agreement-page-model-response.schema.js";
import { getCurrentAgreementPageModelUseCase } from "../use-cases/get-current-agreement-page-model.use-case.js";

export const getCurrentAgreementRoute = {
  method: "GET",
  path: "/agreements/current",
  options: {
    description:
      "Get the current Agreement page model by source identity and SBI account",
    tags: ["api"],
    validate: {
      headers: agreementIdentityHeadersSchema,
      query: getCurrentAgreementQuerySchema,
    },
    response: { schema: agreementPageModelResponseSchema },
  },
  async handler(request, h) {
    const { mode } = request.query;
    const {
      "x-agreement-code": code,
      "x-agreement-client-ref": clientRef,
      "x-agreement-sbi": sbi,
    } = request.headers;
    const { pageModel, etag } = await getCurrentAgreementPageModelUseCase({
      code,
      clientRef,
      sbi,
      mode,
    });

    return h.response(pageModel).header("ETag", etag);
  },
};
