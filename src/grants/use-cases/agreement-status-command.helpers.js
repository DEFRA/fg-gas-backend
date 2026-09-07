import { config } from "../../common/config.js";
import {
  canHandleInternalCommand,
  internalMessageBusTarget,
} from "../../common/internal-command-bus.js";
import { internalCommandTypes } from "../../common/internal-command-types.js";

// Grants whose Agreements are managed by GAS handle their own status updates on
// the internal bus; everything else still goes out to the legacy Agreements API.
export const resolveAgreementStatusCommandTarget = async (command) =>
  (await canHandleInternalCommand(
    internalCommandTypes.AGREEMENT_STATUS_UPDATE,
    command,
  ))
    ? internalMessageBusTarget
    : config.sns.updateAgreementStatusTopicArn;
