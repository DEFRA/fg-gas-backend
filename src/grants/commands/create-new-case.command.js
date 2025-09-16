import { CloudEvent } from "../../common/cloud-event.js";
import { CaseStatus } from "../models/case-status.js";

export class CreateNewCaseCommand extends CloudEvent {
  constructor(application) {
    super("case.create", {
      caseRef: application.clientRef,
      workflowCode: application.code,
      status: CaseStatus.New,
      payload: {
        createdAt: application.createdAt,
        submittedAt: application.submittedAt,
        identifiers: application.identifiers,
        answers: application.answers,
      },
    });
  }
}
