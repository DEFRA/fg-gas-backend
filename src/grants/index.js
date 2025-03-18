import { grantService } from "./grant-service.js";

/**
 * @type {import('@hapi/hapi').Plugin<any>}
 */
export const grantsPlugin = {
  name: "grants",
  async register(server) {
    server.route({
      method: "POST",
      path: "/grants",
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
      async handler(_request, _h) {
        const grants = await grantService.findAll();

        return grants.map((grant) => ({
          code: grant.code,
          metadata: {
            description: grant.metadata.description,
            startDate: grant.metadata.startDate,
          },
          actions: grant.actions,
        }));
      },
    });

    server.route({
      method: "GET",
      path: "/grants/{code}",
      async handler(request, _h) {
        const grant = await grantService.findByCode(request.params.code);

        return {
          code: grant.code,
          metadata: {
            description: grant.metadata.description,
            startDate: grant.metadata.startDate,
          },
          actions: grant.actions,
        };
      },
    });

    server.route({
      method: "GET",
      path: "/grants/{code}/actions/{name}/invoke",
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
