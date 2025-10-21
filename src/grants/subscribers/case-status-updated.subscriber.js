import { config } from "../../common/config.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { applyExternalStateChange } from "../use-cases/apply-event-status-change.service.js";

export const caseStatusUpdatedSubscriber = new SqsSubscriber({
  queueUrl: config.sqs.updateStatusQueueUrl,
  async onMessage(message) {
    const { data } = message;

    // Use the generic state change handler
    // This maps the external status from Case Working (CW) to internal application state
    await applyExternalStateChange({
      sourceSystem: "CW",
      clientRef: data.caseRef,
      externalRequestedState: data.currentStatus,
      eventData: data,
    });
  },
});
