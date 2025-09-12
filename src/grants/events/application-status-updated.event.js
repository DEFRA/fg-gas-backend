import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationStatusUpdatedEvent extends CloudEvent {
  constructor(application) {
    super("application.status", {
      clientRef: application.clientRef,
      code: application.code,
      createdAt: application.createdAt,
      submittedAt: application.submittedAt,
      identifiers: application.identifiers,
      answers: application.answers,
      status: application.status,
      agreements: application.agreements,
    });
  }
}
