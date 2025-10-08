import { CloudEvent } from "../../common/cloud-event.js";

export class CreateNewCaseCommand extends CloudEvent {
  constructor(application) {
    super("case.create", {
      caseRef: application.clientRef,
      workflowCode: application.code,
      payload: {
        createdAt: application.createdAt,
        submittedAt: application.submittedAt,
        identifiers: application.identifiers,
        answers: application.getAnswers(),
      },
    });
  }
}
