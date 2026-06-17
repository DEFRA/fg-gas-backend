import {
  currentAgreementGetRoute,
  currentAgreementPostRoute,
} from "./routes/current-agreement.route.js";
import { invokeAgreementPostActionRoute } from "./routes/invoke-agreement-action.route.js";
import { renderAgreementGetRoute } from "./routes/render-agreement.route.js";

export const agreements = {
  name: "agreements",
  async register(server) {
    server.route([
      currentAgreementGetRoute,
      currentAgreementPostRoute,
      renderAgreementGetRoute,
      invokeAgreementPostActionRoute,
    ]);
  },
};
