import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTraceParent } from "../../common/trace-parent.js";
import {
  cleanupStaleLocks,
  freeFifoLock,
  getFifoLocks,
  setFifoLock,
} from "../repositories/fifo-lock.repository.js";
import {
  claimEvents,
  deadLetterEvent,
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
          await this.processWithLock(claimToken, availableSegregationRef);
        }
        await this.processResubmittedEvents();
        await this.processFailedEvents();
        await this.processDeadEvents();
        await this.cleanupStaleLocks(InboxSubscriber.ACTOR);
      } catch (error) {
        logger.error(error, "Error polling inbox");
      }

      await setTimeout(this.interval);
    }
  }

  async processWithLock(claimToken, segregationRef) {
    const lock = await setFifoLock(InboxSubscriber.ACTOR, segregationRef);
    if (!lock.upsertedCount && !lock.modifiedCount) {
      logger.info(
        `Inbox Unable to process lock for segregationRef ${segregationRef}`,
      );
      return;
    }
    try {
      const events = await claimEvents(claimToken, segregationRef);
      await this.processEvents(events);
    } finally {
      await freeFifoLock(InboxSubscriber.ACTOR, segregationRef);
    }
  }

  async getNextAvailable() {
    const locks = await getFifoLocks(InboxSubscriber.ACTOR);
    const lockIds = locks.map((lock) => lock.segregationRef);
    const available = await findNextMessage(lockIds);

    if (!available) {
      return null;
    }

    if (available?.segregationRef === null) {
      await deadLetterEvent(available);
      return this.getNextAvailable();
    } else {
      return available.segregationRef;
    }
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

  async cleanupStaleLocks(actor) {
    const results = await cleanupStaleLocks(actor);
    results?.modifiedCount &&
      logger.info(`Cleaned up ${results?.modifiedCount} stale fifo locks`);
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
