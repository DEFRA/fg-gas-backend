import { CloudEvent } from "../../common/cloud-event.js";

export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    const identifiers = {
      ...application.identifiers,
      defraId: application.metadata?.defraId ?? "defraId",
    };

    super("agreement.create", {
      clientRef: application.clientRef,
      code: application.code,
      identifiers,
      metadata: application.metadata,
      answers: application.getAnswers(),
    });
  }
}
