import Joi from "joi";
import {
  getCurrentAgreementUseCase,
  postCurrentAgreementUseCase,
} from "../use-cases/current-agreement.use-case.js";

const currentAgreementQuery = Joi.object({
  clientRef: Joi.string().required(),
  code: Joi.string().required(),
  mode: Joi.string().optional(),
  sbi: Joi.string().required(),
});

const currentAgreementPostPayload = Joi.object({
  action: Joi.string().optional(),
  formData: Joi.object().unknown(true).default({}),
});

export const currentAgreementGetRoute = {
  method: "GET",
  path: "/agreements/current",
  options: {
    description: "Render the current Agreement for an application",
    tags: ["api"],
    validate: {
      query: currentAgreementQuery,
    },
  },
  async handler(request, _h) {
    return getCurrentAgreementUseCase({
      clientRef: request.query.clientRef,
      code: request.query.code,
      mode: request.query.mode,
      sbi: request.query.sbi,
    });
  },
};

export const currentAgreementPostRoute = {
  method: "POST",
  path: "/agreements/current",
  options: {
    description: "Post an action against the current Agreement",
    tags: ["api"],
    validate: {
      payload: currentAgreementPostPayload,
      query: currentAgreementQuery,
    },
  },
  async handler(request, h) {
    const result = await postCurrentAgreementUseCase({
      action: request.payload.action,
      clientRef: request.query.clientRef,
      code: request.query.code,
      formData: request.payload.formData,
      sbi: request.query.sbi,
    });

    if (result.statusCode === 204) {
      return h.response().code(204);
    }

    return result;
  },
};
