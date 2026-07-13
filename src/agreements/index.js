import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreementDefinitions } from "./models/agreement-definitions/index.js";
import { findCurrentAgreementRoute } from "./routes/find-current-agreement.route.js";
import { validateEndpointServiceUrls } from "./services/effects/resolve-endpoint-service-url.js";
import { handleCreateAgreementCommand } from "./use-cases/handle-create-agreement-command.use-case.js";

export const agreements = {
  name: "agreements",
  register(server) {
    validateEndpointServiceUrls(agreementDefinitions);

    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      handleCreateAgreementCommand,
    );

    server.route([findCurrentAgreementRoute]);
  },
};
