import { invokeAgreementPostActionRoute } from "./routes/invoke-agreement-action.route.js";

export const agreements = {
  name: "agreements",
  async register(server) {
    server.route([invokeAgreementPostActionRoute]);
  },
};
