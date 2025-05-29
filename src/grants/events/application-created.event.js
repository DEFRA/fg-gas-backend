import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationCreatedEvent extends CloudEvent {
  constructor(application) {
    super("application.created", {
      clientRef: application.clientRef,
      code: application.code,
      createdAt: application.createdAt,
      submittedAt: application.submittedAt,
      identifiers: application.identifiers,
      answers: application.answers,
    });
  }
}
