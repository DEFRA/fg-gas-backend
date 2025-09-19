import { CloudEvent } from "../../common/cloud-event.js";

export class CreateAgreementCommand extends CloudEvent {
  constructor(application) {
    const { clientRef, code, answers } = application;

    super("agreement.create", {
      clientRef,
      code,
      answers,
    });
  }
}
