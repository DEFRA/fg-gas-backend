export const health = {
  name: "health",
  register(server) {
    server.route({
      method: "GET",
      path: "/health",
      options: {
        auth: false,
      },
      handler() {
        return {
          message: "success",
        };
      },
    });
  },
};
