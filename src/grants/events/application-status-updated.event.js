import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationStatusUpdatedEvent extends CloudEvent {
  constructor(props) {
    super(
      "application.status.updated",
      {
        clientRef: props.clientRef,
        grantCode: props.code,
        configVersion: props.configVersion ?? null, // null for pre-Config-Broker apps
        previousStatus: props.previousStatus,
        currentStatus: props.currentStatus,
      },
      `${props.clientRef}-${props.code}`,
    );
  }
}
