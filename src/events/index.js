import { agreementStatusUpdatedSubscriber } from "./subscribers/agreement-status-updated.subscriber.js";
import { caseStatusUpdatedSubscriber } from "./subscribers/case-status-updated.subscriber.js";
import { InboxSubscriber } from "./subscribers/inbox.subscriber.js";
import { OutboxSubscriber } from "./subscribers/outbox.subscriber.js";

export {
  dispatchEvent,
  internalEventTarget,
  registerEventHandler,
} from "./services/event-handlers.js";
export { saveEvents } from "./save-events.js";

export const events = {
  name: "events",
  register(server) {
    const inboxSubscriber = new InboxSubscriber();
    const outboxSubscriber = new OutboxSubscriber();

    server.events.on("start", () => {
      agreementStatusUpdatedSubscriber.start();
      caseStatusUpdatedSubscriber.start();
      inboxSubscriber.start();
      outboxSubscriber.start();
    });

    server.events.on("stop", () => {
      agreementStatusUpdatedSubscriber.stop();
      caseStatusUpdatedSubscriber.stop();
      inboxSubscriber.stop();
      outboxSubscriber.stop();
    });
  },
};
