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

  static forPositions({ previousPosition, currentPosition, ...props }) {
    return new ApplicationStatusUpdatedEvent({
      ...props,
      previousStatus: previousPosition.toString(),
      currentStatus: currentPosition.toString(),
    });
  }
}
