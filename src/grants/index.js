import { grantService } from "./grant-service.js";
import { schemas } from "./schemas.js";
import Joi from "joi";

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
          payload: schemas.Grant,
        },
        response: {
          status: {
            201: Joi.object({ code: schemas.grantCode }),
            400: schemas.ValidationError,
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
          schema: Joi.array().items(schemas.Grant),
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
            code: schemas.grantCode,
          }),
        },
        response: {
          status: {
            200: schemas.Grant,
            400: schemas.ValidationError,
          },
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
            code: schemas.grantCode,
            name: schemas.actionName,
          }),
        },
        response: {
          status: {
            200: Joi.object({}).unknown(),
            400: schemas.ValidationError,
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
          payload: Joi.object({}).unknown(),
          params: Joi.object({
            code: schemas.grantCode,
            name: schemas.actionName,
          }),
        },
        response: {
          status: {
            200: Joi.object({}).unknown(),
            400: schemas.ValidationError,
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
  },
};
