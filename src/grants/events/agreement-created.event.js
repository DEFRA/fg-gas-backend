import { CloudEvent } from "../../common/cloud-event.js";

export class AgreementCreatedEvent extends CloudEvent {
  constructor(application) {
    super("agreement.created", {
      clientRef: application.clientRef,
      applicationData: {
        id: application.id,
        workflowCode: application.code,
        answers: application.answers,
      },
    });
  }
}
