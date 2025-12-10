import { CloudEvent } from "../../common/cloud-event.js";

export class AgreementCreatedEvent extends CloudEvent {
  constructor(props) {
    super("agreement.create", {
      agreementNumber: props.agreementNumber,
      answers: props.answers,
      clientRef: props.clientRef,
      code: props.code,
      createdAt: props.createdAt,
      identifiers: props.identifiers,
      notificationMessageId: props.notificationMessageId,
      submittedAt: props.submittedAt,
    });
  }
}
