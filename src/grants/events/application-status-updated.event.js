import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationStatusUpdatedEvent extends CloudEvent {
  constructor(props) {
    super("application.status.updated", {
      clientRef: props.clientRef,
      oldStatus: props.oldStatus,
      newStatus: props.newStatus,
    });
  }
}
