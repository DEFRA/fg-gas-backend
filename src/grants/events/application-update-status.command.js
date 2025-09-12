import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationUpdateStatusCommand extends CloudEvent {
  constructor({ newStatus, clientRef, code, agreementData }) {
    super("application.update.status", {
      clientRef,
      code,
      newStatus,
      supplementaryData: {
        phase: "PRE_AWARD",
        stage: "AWARD",
        targetNode: "agreements",
        data: agreementData,
      },
    });
  }
}
