import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTraceParent } from "../../common/trace-parent.js";
import {
  freeFifoLock,
  getFifoLocks,
  setFifoLock,
} from "../repositories/fifo-lock.repository.js";
import {
  claimEvents,
  findNextMessage,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/inbox.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { handleAgreementStatusChangeUseCase } from "../use-cases/handle-agreement-status-change.use-case.js";

export const useCaseMap = {
  "io.onsite.agreement.status.foo": handleAgreementStatusChangeUseCase,
};

export class InboxSubscriber {
  static ACTOR = "INBOX";

  constructor() {
    this.interval = config.inbox.inboxPollMs;
    this.running = false;
  }

  async poll() {
    while (this.running) {
      logger.trace("polling inbox");

      try {
        const claimToken = randomUUID();
        const availableSegregationRef = await this.getNextAvailable();
        if (availableSegregationRef) {
          await setFifoLock(InboxSubscriber.ACTOR, availableSegregationRef);
          const events = await claimEvents(claimToken, availableSegregationRef);
          await this.processEvents(events);
          await freeFifoLock(InboxSubscriber.ACTOR, availableSegregationRef);
        }
        await this.processResubmittedEvents();
        await this.processFailedEvents();
        await this.processDeadEvents();
      } catch (error) {
        logger.error(error, "Error polling inbox");
      }

      await setTimeout(this.interval);
    }
  }

  async getNextAvailable() {
    const locks = await getFifoLocks(InboxSubscriber.ACTOR);
    const lockIds = locks.map((lock) => lock.segregationRef);
    const available = await findNextMessage(lockIds);
    return available?.segregationRef;
  }

  async processDeadEvents() {
    const results = await updateDeadEvents();
    results?.modifiedCount &&
      logger.info(`Updated ${results?.modifiedCount} dead inbox events`);
  }

  async processResubmittedEvents() {
    const results = await updateResubmittedEvents();
    results?.modifiedCount &&
      logger.info(`Updated ${results?.modifiedCount} resubmitted inbox events`);
  }

  async processFailedEvents() {
    const results = await updateFailedEvents();
    results?.modifiedCount &&
      logger.info(`Updated ${results?.modifiedCount} failed inbox events`);
  }

  async markEventFailed(inboxEvent) {
    inboxEvent.markAsFailed();
    await update(inboxEvent);
    logger.info(`Marked inbox event unsent ${inboxEvent.messageId}`);
  }

  async markEventComplete(inboxEvent) {
    inboxEvent.markAsComplete();
    await update(inboxEvent);
    logger.info(`Marked inbox event as complete ${inboxEvent.messageId}`);
  }

  // eslint-disable-next-line complexity
  async handleEvent(msg) {
    const { type, event, traceparent, source, messageId } = msg;
    logger.info(
      `Handle event for inbox message ${type}:${source}:${messageId}`,
    );
    try {
      const { data } = event;

      const handler = useCaseMap[type];
      const status = data.currentStatus || data.status || null;
      const clientRef = data.clientRef || data.caseRef || null;
      const code = data.workflowCode || data.code || null;

      if (handler) {
        await withTraceParent(traceparent, async () => handler(msg));
      } else if (status && source) {
        // status transition/update
        await withTraceParent(traceparent, async () =>
          applyExternalStateChange({
            sourceSystem: source,
            clientRef,
            code,
            externalRequestedState: status,
            eventData: data,
          }),
        );
      } else {
        throw new Error(`Unable to handle inbox message ${msg.messageId}`);
      }

      await this.markEventComplete(msg);
    } catch (ex) {
      logger.error(
        `Error handling event for inbox message ${type}:${messageId}`,
      );
      logger.error(ex);
      await this.markEventFailed(msg);
    }
  }

  async processEvents(events) {
    for await (const ev of events) {
      await this.handleEvent(ev);
    }
  }

  start() {
    logger.info("starting inbox subscriber");
    this.running = true;
    this.poll();
  }

  stop() {
    logger.info("stopping inbox subscriber");
    this.running = false;
  }
}
