import { CloudEvent } from "../../common/cloud-event.js";

export class UpdateCaseStatusCommand extends CloudEvent {
  constructor({ newStatus, caseRef, workflowCode, data }) {
    super("case.update.status", {
      caseRef,
      workflowCode,
      newStatus,
      supplementaryData: {
        phase: "PRE_AWARD",
        stage: "AWARD",
        targetNode: "agreements",
        data,
      },
    });
  }
}
