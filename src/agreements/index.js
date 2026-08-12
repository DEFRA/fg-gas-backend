import { hasConfigDefinition } from "../common/config-broker/config-catalog.repository.js";
import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { getAgreementByNumberRoute } from "./routes/get-agreement-by-number.route.js";
import { getCurrentAgreementRoute } from "./routes/get-current-agreement.route.js";
import { invokeAgreementActionRoute } from "./routes/invoke-agreement-action.route.js";
import { prepareAgreementActionRoute } from "./routes/prepare-agreement-action.route.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";

// Only grants that publish an Agreement definition are handled here; the rest
// still belong to the external Agreements service, so the command has to keep
// routing there rather than failing in the loader.
const canHandleCreateAgreementCommand = ({ data }) =>
  hasConfigDefinition({
    grantCode: data.code,
    definitionType: "agreement",
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
