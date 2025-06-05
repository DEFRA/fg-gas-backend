import Joi from "joi";
import { name } from "../schemas/grant/action/name.js";
import { code } from "../schemas/grant/code.js";
import { invokeActionResponseSchema } from "../schemas/responses/invoke-action-response.schema.js";
import { invokeGetActionUseCase } from "../use-cases/invoke-get-action.use-case.js";

export const invokeGetActionRoute = {
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
        200: invokeActionResponseSchema,
      },
    },
  },
  async handler(request, _h) {
    const result = await invokeGetActionUseCase({
      code: request.params.code,
      name: request.params.name,
      params: request.query,
    });

    return result;
  },
};
