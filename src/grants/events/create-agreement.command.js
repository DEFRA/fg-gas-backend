import { CloudEvent } from "../../common/cloud-event.js";

export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    super(
      "agreement.create",
      {
        clientRef: application.clientRef,
        code: application.code,
        configVersion: application.configVersion ?? null, // null for pre-Config-Broker apps
        identifiers: application.identifiers,
        metadata: application.metadata,
        answers: application.getAnswers(),
      },
      `${application.clientRef}-${application.code}`,
    );
  }
}
