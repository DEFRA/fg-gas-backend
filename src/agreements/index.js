import { config } from "../common/config.js";
import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { getAgreementByNumberRoute } from "./routes/get-agreement-by-number.route.js";
import { getCurrentAgreementRoute } from "./routes/get-current-agreement.route.js";
import { invokeAgreementActionRoute } from "./routes/invoke-agreement-action.route.js";
import { prepareAgreementActionRoute } from "./routes/prepare-agreement-action.route.js";
import { handleCreateAgreementCommandUseCase } from "./use-cases/handle-create-agreement-command.use-case.js";
import { handleUpdateAgreementStatusCommandUseCase } from "./use-cases/handle-update-agreement-status-command.use-case.js";

const canHandleAgreementCommand = ({ data }) =>
  config.managedAgreementGrantCodes.includes(data.code);

export const agreements = {
  name: "agreements",
  register(server) {
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
