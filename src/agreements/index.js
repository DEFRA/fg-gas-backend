import { registerDefinitionStore } from "../common/config-broker/definition-stores.js";
import { registerInternalCommandHandler } from "../common/internal-command-handlers.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { isGasManagedAgreementGrant } from "./services/agreement-ownership.js";
import { findStoredVersions } from "./repositories/agreement-definition.repository.js";
import { getAgreementByNumberRoute } from "./routes/get-agreement-by-number.route.js";
import { getCurrentAgreementRoute } from "./routes/get-current-agreement.route.js";
import { invokeAgreementActionRoute } from "./routes/invoke-agreement-action.route.js";
import { prepareAgreementActionRoute } from "./routes/prepare-agreement-action.route.js";
import { findStoredAgreementDefinition } from "./use-cases/find-stored-agreement-definition.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";
import { handleUpdateAgreementStatusCommandUseCase } from "./use-cases/handle-update-agreement-status-command.use-case.js";

const canHandleAgreementCommand = ({ data }) =>
  isGasManagedAgreementGrant(data.code);

export const agreements = {
  name: "agreements",
  register(server) {
    registerDefinitionStore("agreement", {
      storedVersions: findStoredVersions,
      find: findStoredAgreementDefinition,
    });
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      handleCreateAgreementCommandUseCase,
      { canHandle: canHandleAgreementCommand },
    );
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_STATUS_UPDATE,
      handleUpdateAgreementStatusCommandUseCase,
      { canHandle: canHandleAgreementCommand },
    );

    server.route([
      getCurrentAgreementRoute,
      getAgreementByNumberRoute,
      prepareAgreementActionRoute,
      invokeAgreementActionRoute,
    ]);
  },
};
