import { renderAgreementPageQuerySchema } from "../schemas/requests/render-agreement-page-query.schema.js";
import { renderAgreementPageResponseSchema } from "../schemas/responses/render-agreement-page-response.schema.js";
import { renderAgreementPageUseCase } from "../use-cases/render-agreement-page.use-case.js";

export const renderAgreementPageRoute = {
  method: "GET",
  path: "/agreements/render",
  options: {
    description:
      "Render the components, actions and payment data for an agreement page/mode",
    tags: ["api"],
    validate: {
      query: renderAgreementPageQuerySchema,
    },
    response: {
      schema: renderAgreementPageResponseSchema,
    },
  },
  async handler(request, _h) {
    const { code, clientRef, sbi, page, mode } = request.query;

    return renderAgreementPageUseCase({ code, clientRef, sbi, page, mode });
  },
};
