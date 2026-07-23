import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreementDefinitions } from "./models/agreement-definitions/agreement-definition-registry.js";
import { getAgreementByNumberRoute } from "./routes/get-agreement-by-number.route.js";
import { getCurrentAgreementRoute } from "./routes/get-current-agreement.route.js";
import { invokeAgreementActionRoute } from "./routes/invoke-agreement-action.route.js";
import { prepareAgreementActionRoute } from "./routes/prepare-agreement-action.route.js";
import { validateEndpointServiceUrls } from "./services/effects/resolve-endpoint-service-url.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";

export const agreements = {
  name: "agreements",
  register(server) {
    validateEndpointServiceUrls(agreementDefinitions);

    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      handleCreateAgreementCommandUseCase,
    );

    server.route([
      getCurrentAgreementRoute,
      getAgreementByNumberRoute,
      prepareAgreementActionRoute,
      invokeAgreementActionRoute,
    ]);
  },
};
