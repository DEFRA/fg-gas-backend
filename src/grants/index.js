import Joi from "joi";
import * as grantService from "./grant-service.js";
import { createGrantResponse } from "./schemas/responses/create-grant-response.js";
import { createGrantRequest } from "./schemas/requests/create-grant-request.js";
import { getGrantResponse } from "./schemas/responses/get-grant-reponse.js";
import { badRequestResponse } from "./schemas/responses/bad-request-response.js";
import { invokeActionResponse } from "./schemas/responses/invoke-action-response.js";
import { invokePostActionRequest } from "./schemas/requests/invoke-post-action-request.js";
import { createApplicationRequest } from "./schemas/requests/create-application-request.js";
import { createApplicationResponse } from "./schemas/responses/create-application-response.js";
import { code } from "./schemas/grant/code.js";
import { name } from "./schemas/grant/action/name.js";

/**
 * @type {import('@hapi/hapi').Plugin<any>}
 */
export const grantsPlugin = {
  name: "grants",
  async register(server) {
    server.route({
      method: "POST",
      path: "/grants",
      options: {
        description: "Create a grant",
        tags: ["api"],
        validate: {
          payload: createGrantRequest,
        },
        response: {
          status: {
            201: createGrantResponse,
            400: badRequestResponse,
          },
        },
      },
      async handler(request, h) {
        const grant = await grantService.create(request.payload);

        return h
          .response({
            code: grant.code,
          })
          .code(201);
      },
    });

    server.route({
      method: "GET",
      path: "/grants",
      options: {
        description: "Get all grants",
        tags: ["api"],
        response: {
          schema: Joi.array()
            .items(getGrantResponse)
            .label("GetGrantsResponse"),
        },
      },
      async handler(_request, _h) {
        const grants = await grantService.findAll();

        return grants.map((grant) => ({
          code: grant.code,
          metadata: {
            description: grant.metadata.description,
            startDate: grant.metadata.startDate,
          },
          actions: grant.actions,
          questions: grant.questions,
        }));
      },
    });

    server.route({
      method: "GET",
      path: "/grants/{code}",
      options: {
        description: "Find a grant by code",
        tags: ["api"],
        validate: {
          params: Joi.object({
            code,
          }),
        },
        response: {
          schema: getGrantResponse,
        },
      },
      async handler(request, _h) {
        const grant = await grantService.findByCode(request.params.code);

        return {
          code: grant.code,
          metadata: {
            description: grant.metadata.description,
            startDate: grant.metadata.startDate,
          },
          actions: grant.actions,
          questions: grant.questions,
        };
      },
    });

    server.route({
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
        const result = await grantService.invokeGetAction({
          code: request.params.code,
          name: request.params.name,
        });
        return result;
      },
    });

    server.route({
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
        const result = await grantService.invokePostAction({
          code: request.params.code,
          name: request.params.name,
          payload: request.payload,
        });

        return result;
      },
    });

    server.route({
      method: "POST",
      path: "/grants/{code}/applications",
      options: {
        description: "Create an application for a grant",
        tags: ["api"],
        validate: {
          payload: createApplicationRequest,
          params: Joi.object({
            code,
          }),
        },
        response: {
          status: {
            201: createApplicationResponse,
            400: badRequestResponse,
          },
        },
      },
      async handler(request, h) {
        await grantService.submitApplication(
          request.params.code,
          request.payload,
        );

        return h
          .response({
            clientRef: request.payload.metadata.clientRef,
          })
          .code(201);
      },
    });
  },
};
