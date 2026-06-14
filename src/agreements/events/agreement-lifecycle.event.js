import { CloudEvent } from "../../common/cloud-event.js";

const eventTypeByStatus = {
  accepted: "agreement.accepted",
};

export class AgreementLifecycleEvent extends CloudEvent {
  constructor(data) {
    super(
      eventTypeByStatus[data.status] ?? "agreement.created",
      data,
      `${data.clientRef}-${data.code}`,
    );
    this.source = "AS";
  }
}
