import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationCreatedEvent extends CloudEvent {
  constructor(props) {
    super(
      "application.created",
      {
        clientRef: props.clientRef,
        code: props.code,
        status: props.status,
      },
      `${props.clientRef}-${props.code}`,
    );
  }
}
