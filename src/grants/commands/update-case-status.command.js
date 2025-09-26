import { CloudEvent } from "../../common/cloud-event.js";

export class UpdateCaseStatusCommand extends CloudEvent {
  constructor({
    newStatus,
    caseRef,
    workflowCode,
    phase,
    stage,
    targetNode,
    data,
  }) {
    super("case.update.status", {
      caseRef,
      workflowCode,
      newStatus,
      supplementaryData: {
        targetNode,
        phase,
        stage,
        data,
      },
    });
  }
}
