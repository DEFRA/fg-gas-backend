import { CloudEvent } from "../../common/cloud-event.js";

export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    super("agreement.create", {
      clientRef: application.clientRef,
      applicationData: {
        id: application.id,
        workflowCode: application.code,
        answers: application.answers,
      },
    });
  }
}
