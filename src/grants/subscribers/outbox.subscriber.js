import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { config } from "../../common/config.js";
import { getMessageGroupId } from "../../common/get-message-group-id.js";
import { logger } from "../../common/logger.js";
import { publish } from "../../common/sns-client.js";
import {
  claimEvents,
  update,
  updateDeadEvents,
  updateExpiredEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/outbox.repository.js";

export class OutboxSubscriber {
  asyncLocalStorage = new AsyncLocalStorage();

  constructor() {
    this.interval = config.outbox.outboxPollMs;
    this.running = false;
  }

  // eslint-disable-next-line complexity
  async poll() {
    while (this.running) {
      logger.trace("Polling outbox");

      try {
        const claimToken = randomUUID();
        const pendingEvents = await claimEvents(claimToken);

        if (pendingEvents?.length > 0) {
          await this.asyncLocalStorage.run(claimToken, async () =>
            this.processEvents(pendingEvents),
          );
        }

        await this.processResubmittedEvents();
        await this.processFailedEvents();
        await this.processDeadEvents();
        await this.processExpiredEvents();
      } catch (error) {
        logger.error(error, "Error polling outbox");
      }

      await setTimeout(this.interval);
    }
  }

  async processExpiredEvents() {
    const results = await updateExpiredEvents();
    results?.modifiedCount &&
      logger.trace(`Updated ${results?.modifiedCount} expired outbox events`);
  }

  async processDeadEvents() {
    const results = await updateDeadEvents();
    results?.modifiedCount &&
      logger.trace(`Updated ${results?.modifiedCount} dead outbox events`);
  }

  async processResubmittedEvents() {
    const results = await updateResubmittedEvents();
    results?.modifiedCount &&
      logger.trace(
        `Updated ${results?.modifiedCount} resubmitted outbox events`,
      );
  }

  async processFailedEvents() {
    const results = await updateFailedEvents();
    results?.modifiedCount &&
      logger.trace(`Updated ${results?.modifiedCount} failed outbox events`);
  }

  async markEventUnsent(event) {
    const claimedBy = this.asyncLocalStorage.getStore();
    event.markAsFailed();
    await update(event, claimedBy);
    logger.trace(`Marked outbox event unsent ${event._id}`);
  }

  async markEventComplete(event) {
    const claimedBy = this.asyncLocalStorage.getStore();
    event.markAsComplete();
    await update(event, claimedBy);
    logger.trace(`Marked outbox event as complete: ${event._id}`);
  }

  async sendEvent(event) {
    const {
      target: topic,
      event: data,
      event: { messageGroupId },
    } = event;
    logger.trace(`Send outbox event to ${topic}`);
    try {
      await publish(
        this.topicStringToFifo(topic),
        data,
        this.getMessageGroupId(messageGroupId, data),
      );
      await this.markEventComplete(event);
    } catch (ex) {
      logger.error(ex);
      this.markEventUnsent(event);
    }
  }

  async processEvents(events) {
    await Promise.all(events.map((event) => this.sendEvent(event)));
    logger.trace("All outbox events processed.");
  }

  // TODO: remove once there are no more standard events
  getMessageGroupId(id, data) {
    return getMessageGroupId(id, data);
  }

  // TODO: remove once there are no more standard events
  // temp while we transition to fifo
  topicStringToFifo(topic) {
    if (topic.search(/_fifo.fifo$/) === -1) {
      return `${topic}_fifo.fifo`;
    }

    return topic;
  }

  async start() {
    logger.info("Starting outbox subscriber");
    this.running = true;
    this.poll();
  }

  stop() {
    logger.info("Stopping outbox subscriber");
    this.running = false;
  }
}
