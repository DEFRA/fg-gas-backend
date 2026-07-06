import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { handleCreateAgreementCommand } from "./use-cases/handle-create-agreement-command.use-case.js";

export const agreements = {
  name: "agreements",
  register(_server) {
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_CREATE,
      handleCreateAgreementCommand,
    );
  },
};
