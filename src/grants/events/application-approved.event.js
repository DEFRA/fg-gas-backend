import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationApprovedEvent extends CloudEvent {
  constructor(applicationApproved) {
    super("application.approved", {
      clientRef: applicationApproved.clientRef,
      previousStatus: applicationApproved.previousStatus,
      currentStatus: applicationApproved.currentStatus,
    });
  }
}
