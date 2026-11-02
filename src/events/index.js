import { registerBucket } from "../common/buckets/registry.js";
import { config } from "../common/config.js";
import { inboxBucket } from "./buckets/inbox.bucket.js";
import { outboxBucket } from "./buckets/outbox.bucket.js";
import { DeadLetterGauge } from "./dead-letters.js";
import { countDeadLetters as countInboxDeadLetters } from "./repositories/inbox.repository.js";
import { countDeadLetters as countOutboxDeadLetters } from "./repositories/outbox.repository.js";
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
    registerBucket(outboxBucket());
    registerBucket(inboxBucket());

    const inboxSubscriber = new InboxSubscriber();
    const outboxSubscriber = new OutboxSubscriber();
    const deadLetterGauge = new DeadLetterGauge({
      enabled: config.metrics.enabled,
      counts: {
        inbox: countInboxDeadLetters,
        outbox: countOutboxDeadLetters,
      },
    });

    server.events.on("start", () => {
      agreementStatusUpdatedSubscriber.start();
      caseStatusUpdatedSubscriber.start();
      inboxSubscriber.start();
      outboxSubscriber.start();
      deadLetterGauge.start();
    });

    server.events.on("stop", () => {
      agreementStatusUpdatedSubscriber.stop();
      caseStatusUpdatedSubscriber.stop();
      inboxSubscriber.stop();
      outboxSubscriber.stop();
      deadLetterGauge.stop();
    });
  },
};
