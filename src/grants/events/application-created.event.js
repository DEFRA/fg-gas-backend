import { CloudEvent } from "../../common/cloud-event.js";

export class ApplicationCreatedEvent extends CloudEvent {
  constructor(props) {
    super(
      "application.created",
      {
        clientRef: props.clientRef,
        code: props.code,
        configVersion: props.configVersion ?? null, // null for pre-Config-Broker apps
        status: props.status,
      },
      `${props.clientRef}-${props.code}`,
    );
  }
}
