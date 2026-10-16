import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const applicationCreated = defineEventType({
  name: "ApplicationCreated",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.application.created`,
  boxes: [OUTBOX],
  refs: ({ data }) => [["ref", data?.clientRef]],
});

export class ApplicationCreatedEvent extends CloudEvent {
  constructor(props) {
    super(
      "application.created",
      {
        clientRef: props.clientRef,
        code: props.code,
        originalConfigVersion: props.originalConfigVersion ?? null,
        status: props.status,
      },
      `${props.clientRef}-${props.code}`,
    );
  }
}
