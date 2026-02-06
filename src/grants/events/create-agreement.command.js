import { CloudEvent } from "../../common/cloud-event.js";

export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    super(
      "agreement.create",
      {
        clientRef: application.clientRef,
        code: application.code,
        identifiers: application.identifiers,
        metadata: application.metadata,
        answers: application.getAnswers(),
      },
      `${application.clientRef}-${application.code}`,
    );
  }
}
