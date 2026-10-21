import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { caseRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const caseCreate = defineEventType({
  name: "CreateCase",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.case.create`,
  boxes: [OUTBOX],
  refs: ({ data }) => {
    const { workflowCode, caseRef, previousCaseRef } = data ?? {};

    return [
      ...caseRefsOf(workflowCode, caseRef),
      ...caseRefsOf(workflowCode, previousCaseRef),
    ];
  },
});

export class CreateNewCaseCommand extends CloudEvent {
  constructor(application) {
    super(
      "case.create",
      {
        caseRef: application.clientRef,
        workflowCode: application.code,
        previousCaseRef: application?.metadata?.previousClientRef,
        payload: {
          originalConfigVersion: application.originalConfigVersion ?? null,
          createdAt: application.createdAt,
          submittedAt: application.submittedAt,
          identifiers: application.identifiers,
          metadata: application.metadata,
          answers: application.getAnswers(),
        },
      },
      `${application.clientRef}-${application.code}`,
    );
  }
}
