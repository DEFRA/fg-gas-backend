import Joi from "joi";
import { name } from "../schemas/grant/action/name.js";
import { code } from "../schemas/grant/code.js";
import { invokePostActionRequest } from "../schemas/requests/invoke-post-action-request.schema.js";
import { invokeActionResponseSchema } from "../schemas/responses/invoke-action-response.schema.js";
import { invokeActionUseCase } from "../use-cases/invoke-action.use-case.js";

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
    return await handleInvokeAction(request);
  },
};

export const invokePostActionRoute = {
  method: "POST",
  path: "/grants/{code}/actions/{name}/invoke",
  options: {
    description: "Invoke a named POST action on the grant specified by code",
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
    return await handleInvokeAction(request);
  },
};

const handleInvokeAction = async (request) =>
  await invokeActionUseCase({
    code: request.params.code,
    name: request.params.name,
    method: request.method,
    payload: request.payload,
    params: request.query,
  });

// Export an array of routes for easier registration
export const invokeActionRoutes = [invokeGetActionRoute, invokePostActionRoute];
