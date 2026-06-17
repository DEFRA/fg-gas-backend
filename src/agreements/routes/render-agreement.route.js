import Joi from "joi";
import { renderAgreementUseCase } from "../use-cases/render-agreement.use-case.js";

const renderAgreementResponse = Joi.object({
  agreement: Joi.object().required(),
  actions: Joi.array().items(Joi.object().unknown(true)).optional(),
  components: Joi.array().items(Joi.object().unknown(true)).required(),
  errors: Joi.array().items(Joi.object().unknown(true)).optional(),
  page: Joi.object({
    id: Joi.string().required(),
    title: Joi.string().required(),
  })
    .unknown(true)
    .required(),
  source: Joi.string().valid("config").required(),
})
  .unknown(true)
  .label("RenderAgreementResponse");

export const renderAgreementGetRoute = {
  method: "GET",
  path: "/agreements/{agreementNumber}",
  options: {
    description: "Render an Agreement",
    tags: ["api"],
    validate: {
      params: Joi.object({
        agreementNumber: Joi.string().required(),
      }),
      query: Joi.object({
        page: Joi.string().optional(),
      }),
    },
    response: {
      status: {
        200: renderAgreementResponse,
      },
    },
  },
  async handler(request, _h) {
    return renderAgreementUseCase({
      agreementNumber: request.params.agreementNumber,
      page: request.query.page,
    });
  },
};
