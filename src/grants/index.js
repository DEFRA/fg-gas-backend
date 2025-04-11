import Joi from "joi";
import * as grantService from "./grant-service.js";
import * as schemas from "./schemas.js";

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
            201: Joi.object({ code: schemas.grantCode }).label(
              "CreateGrantResponse",
            ),
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
          schema: Joi.array().items(schemas.Grant).label("Grants"),
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
            200: Joi.object({}).unknown().label("InvokeActionResponse"),
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
          payload: Joi.object({}).unknown().label("InvokePostActionRequest"),
          params: Joi.object({
            code: schemas.grantCode,
            name: schemas.actionName,
          }),
        },
        response: {
          status: {
            200: Joi.object({}).unknown().label("InvokeActionResponse"),
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

    server.route({
      method: "POST",
      path: "/grants/{code}/applications",
      options: {
        description: "Create an application for a grant",
        tags: ["api"],
        validate: {
          payload: schemas.CreateApplicationRequest,
          params: Joi.object({
            code: schemas.grantCode,
          }),
        },
        response: {
          status: {
            201: Joi.object({
              clientRef: schemas.clientRef,
            }).label("CreateApplicationResponse"),
            400: schemas.ValidationError,
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
