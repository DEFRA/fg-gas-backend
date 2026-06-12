import { CloudEvent } from "../../common/cloud-event.js";

export class AgreementCreatedEvent extends CloudEvent {
  constructor(data) {
    super("agreement.created", data, `${data.clientRef}-${data.code}`);
    this.source = "AS";
  }
}
