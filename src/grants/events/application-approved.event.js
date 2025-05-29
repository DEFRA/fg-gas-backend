import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationApprovedEvent extends CloudEvent {
  constructor(application) {
    super("application.approved", {
      clientRef: application.clientRef,
      code: application.code,
      createdAt: application.createdAt,
      submittedAt: application.submittedAt,
      identifiers: application.identifiers,
      answers: application.answers,
    });
  }
}
