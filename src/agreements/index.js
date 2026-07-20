import { internalCommandTypes } from "../common/internal-command-types.js";
import { registerInternalMessageHandler } from "../common/internal-message-bus.js";
import { agreementDefinitions } from "./models/agreement-definitions/agreement-definition-registry.js";
import { getAgreementByNumberRoute } from "./routes/get-agreement-by-number.route.js";
import { getCurrentAgreementRoute } from "./routes/get-current-agreement.route.js";
import { invokeAgreementActionRoute } from "./routes/invoke-agreement-action.route.js";
import { prepareAgreementActionRoute } from "./routes/prepare-agreement-action.route.js";
import { validateEndpointServiceUrls } from "./services/effects/resolve-endpoint-service-url.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";

const canHandleCreateAgreementCommand = ({ data }) =>
  agreementDefinitions.some(({ code }) => code === data?.code);

export const agreements = {
  name: "agreements",
  register(server) {
    validateEndpointServiceUrls(agreementDefinitions);

    registerInternalMessageHandler({
      type: internalCommandTypes.AGREEMENT_CREATE,
      handler: handleCreateAgreementCommandUseCase,
      canHandle: canHandleCreateAgreementCommand,
    });

    server.route([
      getCurrentAgreementRoute,
      getAgreementByNumberRoute,
      prepareAgreementActionRoute,
      invokeAgreementActionRoute,
    ]);
  },
};
