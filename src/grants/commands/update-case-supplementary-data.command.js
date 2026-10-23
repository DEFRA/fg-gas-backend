import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { applicationRefsOf, caseRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const caseUpdateSupplementaryData = defineEventType({
  name: "UpdateCaseSupplementaryData",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.case.update.supplementary.data`,
  boxes: [OUTBOX],
  refs: ({ data }) => {
    const { workflowCode, caseRef } = data ?? {};

    return [
      ...caseRefsOf(workflowCode, caseRef),
      ...applicationRefsOf(workflowCode, caseRef),
    ];
  },
});

export class UpdateCaseSupplementaryDataCommand extends CloudEvent {
  constructor({ caseRef, workflowCode, supplementaryData }) {
    super(
      "case.update.supplementary.data",
      { caseRef, workflowCode, supplementaryData },
      `${caseRef}-${workflowCode}`,
    );
  }
}
