import { CloudEvent } from "../../common/cloud-event.js";

export class UpdateCaseStatusCommand extends CloudEvent {
  // eslint-disable-next-line complexity
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
    const supplementaryData = {
      phase,
      stage,
    };
    if (targetNode) {
      supplementaryData.targetNode = targetNode;
    }
    if (dataType) {
      supplementaryData.dataType = dataType;
    }
    if (key) {
      supplementaryData.key = key;
    }
    if (data) {
      supplementaryData.data = data;
    }

    super(
      "case.update.status",
      {
        caseRef,
        workflowCode,
        newStatus,
        supplementaryData,
      },
      `${caseRef}-${workflowCode}`,
    );
  }
}
