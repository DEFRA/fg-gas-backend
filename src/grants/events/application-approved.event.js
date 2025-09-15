import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationApprovedEvent extends CloudEvent {
  constructor(applicationApprovedEvent) {
    super("application.approved", {
      code: applicationApprovedEvent.code,
      clientRef: applicationApprovedEvent.clientRef,
      previousStatus: applicationApprovedEvent.previousStatus,
      currentStatus: applicationApprovedEvent.currentStatus,
    });
  }
}
