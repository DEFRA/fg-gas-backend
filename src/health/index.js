export const health = {
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
