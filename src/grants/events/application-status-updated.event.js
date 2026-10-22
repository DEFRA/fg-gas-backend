import { CloudEvent } from "../../common/cloud-event.js";
import { config } from "../../common/config.js";
import { applicationRefsOf } from "../../events/case-refs.js";
import { OUTBOX, defineEventType } from "../../events/event-types.js";

export const applicationStatusUpdated = defineEventType({
  name: "ApplicationStatusUpdated",
  sentAs: `cloud.defra.${config.cdpEnvironment}.${config.serviceName}.application.status.updated`,
  boxes: [OUTBOX],
  refs: ({ data }) => applicationRefsOf(data?.grantCode, data?.clientRef),
});

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
