import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { publish } from "../../common/sns-client.js";
import {
  claimEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/outbox.repository.js";

export class OutboxSubscriber {
  asyncLocalStorage = new AsyncLocalStorage();

  constructor() {
    this.interval = config.outboxPollMs;
    this.running = false;
  }

  async poll() {
    while (this.running) {
      const claimToken = randomUUID();
      const pendingEvents = await claimEvents(claimToken);

      if (pendingEvents?.length > 0) {
        logger.info(`Claimed ${pendingEvents.length} outbox events`);
        this.asyncLocalStorage.run(claimToken, async () =>
          this.processEvents(pendingEvents),
        );
      }

      await this.processResubmittedEvents();
      await this.processFailedEvents();
      await this.processDeadEvents();
      await setTimeout(this.interval);
    }
  }

  async processDeadEvents() {
    logger.info("Processing dead outbox events");
    const results = await updateDeadEvents();
    logger.info(`Updated ${results?.modifiedCount} dead outbox events`);
  }

  async processResubmittedEvents() {
    logger.info("Processing resubmitted outbox events");
    const results = await updateResubmittedEvents();
    logger.info(`Updated ${results?.modifiedCount} resubmitted outbox events`);
  }

  async processFailedEvents() {
    logger.info("Processing failed outbox events");
    const results = await updateFailedEvents();
    logger.info(`Updated ${results?.modifiedCount} failed outbox events`);
  }

  async markEventUnsent(event) {
    const claimedBy = this.asyncLocalStorage.getStore();
    logger.info(`mark event failed with claim token: ${claimedBy}`);
    event.markAsFailed();
    await update(event, claimedBy);
    logger.info(`Marked outbox event unsent ${event._id}`);
  }

  async markEventComplete(event) {
    const claimedBy = this.asyncLocalStorage.getStore();
    logger.info(`mark event complete with claim token: ${claimedBy}`);
    event.markAsComplete();
    await update(event, claimedBy);
    logger.info(`Marked outbox event as complete: ${event._id}`);
  }

  async sendEvent(event) {
    const { target: topic, event: data } = event;
    logger.info(`Send outbox event to ${topic}`);
    try {
      await publish(topic, data);
      await this.markEventComplete(event);
    } catch (ex) {
      logger.error(`Error sending outbox event to topic ${topic}`);
      logger.error(ex);
      this.markEventUnsent(event);
    }
  }

  async processEvents(events) {
    logger.info(`Processing ${events.length} outbox events.`);
    await Promise.all(events.map((event) => this.sendEvent(event)));
    logger.info("All outbox events processed.");
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
