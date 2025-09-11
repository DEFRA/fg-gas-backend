import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationCreatedEvent extends CloudEvent {
  constructor(application) {
    super("application.created", {
      clientRef: application.clientRef,
      code: application.code,
      status: `${application.phase}:${application.stage}:${application.status}`,
    });
  }
}
