import Joi from "joi";
import { invokeAgreementActionRequest } from "../schemas/requests/invoke-agreement-action-request.schema.js";
import { invokeAgreementActionResponse } from "../schemas/responses/invoke-agreement-action-response.schema.js";
import { invokeAgreementActionUseCase } from "../use-cases/invoke-agreement-action.use-case.js";

export const invokeAgreementPostActionRoute = {
  method: "POST",
  path: "/agreements/{agreementNumber}/actions/{name}",
  options: {
    description: "Accept an Agreement item",
    tags: ["api"],
    validate: {
      params: Joi.object({
        agreementNumber: Joi.string().required(),
        name: Joi.string().required(),
      }),
      payload: invokeAgreementActionRequest,
    },
    response: {
      status: {
        200: invokeAgreementActionResponse,
      },
    },
  },
  async handler(request, _h) {
    return invokeAgreementActionUseCase({
      actionName: request.params.name,
      agreementNumber: request.params.agreementNumber,
      payload: request.payload,
    });
  },
};
