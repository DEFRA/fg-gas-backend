import { config } from "../../common/config.js";
import {
  canHandleInternalCommand,
  internalCommandTarget,
} from "../../common/internal-command-handlers.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";

// Grants whose Agreements are managed by GAS handle their own status updates on
// internal command dispatch; everything else still goes out to the legacy Agreements API.
export const resolveAgreementStatusCommandTarget = async (command) =>
  (await canHandleInternalCommand(
    internalCommandTypes.AGREEMENT_STATUS_UPDATE,
    command,
  ))
    ? internalCommandTarget
    : config.sns.updateAgreementStatusTopicArn;
