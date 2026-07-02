import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationStatusUpdatedEvent extends CloudEvent {
  constructor(props) {
    super(
      "application.status.updated",
      {
        clientRef: props.clientRef,
        grantCode: props.code,
        currentConfigVersion: props.currentConfigVersion ?? null,
        previousStatus: props.previousStatus,
        currentStatus: props.currentStatus,
      },
      `${props.clientRef}-${props.code}`,
    );
  }
}
