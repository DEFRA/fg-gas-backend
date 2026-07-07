import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { agreementDefinitions } from "./models/agreement-definitions/index.js";
import { handleCreateAgreementCommand } from "./use-cases/handle-create-agreement-command.use-case.js";
import { validateEndpointServiceUrls } from "./use-cases/resolve-endpoint-service-url.js";

export const agreements = {
  name: "agreements",
  register(_server) {
    validateEndpointServiceUrls(agreementDefinitions);

    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      handleCreateAgreementCommand,
    );
  },
};
