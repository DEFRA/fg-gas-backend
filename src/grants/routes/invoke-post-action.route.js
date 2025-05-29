import Joi from "joi";
import { name } from "../schemas/grant/action/name.js";
import { code } from "../schemas/grant/code.js";
import { invokePostActionRequest } from "../schemas/requests/invoke-post-action-request.schema.js";
import { invokeActionResponseSchema } from "../schemas/responses/invoke-action-response.schema.js";
import { invokePostActionUseCase } from "../use-cases/invoke-post-action.use-case.js";

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
        200: invokeActionResponseSchema,
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
