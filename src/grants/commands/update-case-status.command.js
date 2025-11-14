import { CloudEvent } from "../../common/cloud-event.js";

export class UpdateCaseStatusCommand extends CloudEvent {
  constructor({
    newStatus,
    caseRef,
    workflowCode,
    phase,
    stage,
    targetNode,
    dataType,
    key,
    data,
  }) {
    super("case.update.status", {
      caseRef,
      workflowCode,
      newStatus,
      supplementaryData: {
        targetNode,
        dataType,
        key,
        phase,
        stage,
        data,
      },
    });
  }
}
