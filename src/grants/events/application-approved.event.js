import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationApprovedEvent extends CloudEvent {
  constructor(applicationApprovedEvent) {
    const { code, clientRef, oldStatus, newStatus } = applicationApprovedEvent;
    super("application.approved", {
      code,
      clientRef,
      oldStatus,
      newStatus,
    });
  }
}
