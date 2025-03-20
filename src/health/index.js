/**
 * @type {import('@hapi/hapi').Plugin<any>}
 */
export const healthPlugin = {
  name: "health",
  register(server) {
    server.route({
      method: "GET",
      path: "/health",
      handler() {
        return {
          message: "success",
        };
      },
    });
  },
};
