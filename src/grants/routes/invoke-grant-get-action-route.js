import Joi from "joi";
import { code } from "../schemas/grant/code.js";
import { name } from "../schemas/grant/action/name.js";
import { badRequestResponse } from "../schemas/responses/bad-request-response.js";
import { invokeActionResponse } from "../schemas/responses/invoke-action-response.js";
import { invokeGetActionUseCase } from "../use-cases/invoke-get-action-use-case.js";

export const invokeGrantGetActionRoute = {
  method: "GET",
  path: "/grants/{code}/actions/{name}/invoke",
  options: {
    description: "Invoke a named GET action on the grant specified by code",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
        name,
      }),
    },
    response: {
      status: {
        200: invokeActionResponse,
        400: badRequestResponse,
      },
    },
  },
  async handler(request, _h) {
    const result = await invokeGetActionUseCase({
      code: request.params.code,
      name: request.params.name,
    });
    return result;
  },
};
