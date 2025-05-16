import Joi from "joi";
import { badRequestResponse } from "../schemas/responses/bad-request-response.js";
import { invokeActionResponse } from "../schemas/responses/invoke-action-response.js";
import { invokePostActionRequest } from "../schemas/requests/invoke-post-action-request.js";
import { code } from "../schemas/grant/code.js";
import { name } from "../schemas/grant/action/name.js";
import { invokePostActionUseCase } from "../use-cases/invoke-post-action-use-case.js";

export const invokePostActionRoute = {
  method: "POST",
  path: "/grants/{code}/actions/{name}/invoke",
  options: {
    description: "Invoke a named GET action on the grant specified by code",
    tags: ["api"],
    validate: {
      params: Joi.object({
        code,
        name,
      }),
      payload: invokePostActionRequest,
    },
    response: {
      status: {
        200: invokeActionResponse,
        400: badRequestResponse,
      },
    },
  },
  async handler(request, _h) {
    const result = await invokePostActionUseCase({
      code: request.params.code,
      name: request.params.name,
      payload: request.payload,
    });

    return result;
  },
};
