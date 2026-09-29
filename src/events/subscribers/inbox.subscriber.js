import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { dispatchEvent } from "../services/event-handlers.js";
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
  processExpiredEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/inbox.repository.js";

export class InboxSubscriber {
  asyncLocalStorage = new AsyncLocalStorage();

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
        await this.processExpiredEvents();
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
      await this.asyncLocalStorage.run(claimToken, async () =>
        this.processEvents(events),
      );
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

    if (!available.segregationRef) {
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

  async processExpiredEvents() {
    const results = await processExpiredEvents();
    results?.modifiedCount &&
      logger.info(`Updated ${results?.modifiedCount} expired inbox events`);
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

  // False when the claim was lost and nothing was written.
  async writeClaimed(inboxEvent) {
    const claimedBy = this.asyncLocalStorage.getStore();
    const result = await update(inboxEvent, claimedBy);

    if (result?.matchedCount === 0) {
      logger.warn(
        `Inbox event ${inboxEvent.messageId} was reclaimed before its handler finished`,
      );
      return false;
    }

    return true;
  }

  async markEventFailed(inboxEvent, error) {
    inboxEvent.markAsFailed(error);
    if (await this.writeClaimed(inboxEvent)) {
      logger.info(`Marked inbox event unsent ${inboxEvent.messageId}`);
    }
  }

  async markEventComplete(inboxEvent) {
    inboxEvent.markAsComplete();
    if (await this.writeClaimed(inboxEvent)) {
      logger.info(`Marked inbox event as complete ${inboxEvent.messageId}`);
    }
  }

  async handleEvent(message) {
    const { type, source, messageId } = message;
    logger.info(
      `Handle event for inbox message ${type}:${source}:${messageId}`,
    );

    try {
      await dispatchEvent(message);
      await this.markEventComplete(message);
    } catch (error) {
      logger.error(
        error,
        `Error handling event for inbox message ${type}:${messageId}`,
      );
      await this.markEventFailed(message, error);
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
