import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { applicationRefsOf, caseRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const caseUpdateStatus = defineEventType({
  name: "UpdateCaseStatus",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.case.update.status`,
  boxes: [OUTBOX],
  refs: ({ data }) => {
    const { workflowCode, caseRef } = data ?? {};

    return [
      ...caseRefsOf(workflowCode, caseRef),
      ...applicationRefsOf(workflowCode, caseRef),
    ];
  },
});

export class UpdateCaseStatusCommand extends CloudEvent {
  // eslint-disable-next-line complexity
  constructor({
    newStatus,
    caseRef,
    workflowCode,
    configVersion,
    phase,
    stage,
    targetNode,
    dataType,
    key,
    data,
  }) {
    const supplementaryData = {
      currentConfigVersion: configVersion ?? null,
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
