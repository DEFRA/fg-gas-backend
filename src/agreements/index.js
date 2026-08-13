import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { getAgreementByNumberRoute } from "./routes/get-agreement-by-number.route.js";
import { getCurrentAgreementRoute } from "./routes/get-current-agreement.route.js";
import { invokeAgreementActionRoute } from "./routes/invoke-agreement-action.route.js";
import { prepareAgreementActionRoute } from "./routes/prepare-agreement-action.route.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";
import { canLoadDefinitionForCreation } from "./use-cases/load-agreement-definition.js";

// Every grant published through the config broker has a config version, whether
// or not it ships an Agreement definition, so only the definition itself says
// who owns the Agreement. Grants without one stay with the external service.
const canHandleCreateAgreementCommand = ({ data }) =>
  canLoadDefinitionForCreation({
    code: data.code,
    configVersion: data.currentConfigVersion,
  });

export const agreements = {
  name: "agreements",
  register(server) {
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      handleCreateAgreementCommandUseCase,
      { canHandle: canHandleCreateAgreementCommand },
    );

    server.route([
      getCurrentAgreementRoute,
      getAgreementByNumberRoute,
      prepareAgreementActionRoute,
      invokeAgreementActionRoute,
    ]);
  },
};
