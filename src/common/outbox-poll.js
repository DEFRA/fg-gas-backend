import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  fetchPendingEvents,
  update,
} from "../grants/repositories/event-publication-outbox.respository.js";
import { logger } from "./logger.js";
import { publish } from "./sns-client.js";

/*
 * Class to poll the event_publication_outbox table
 */
export class OutboxSubscriber {
  constructor(interval) {
    this.interval = interval;
    this.running = false;
  }

  async poll() {
    while (this.running) {
      const claimToken = randomUUID();
      const events = await fetchPendingEvents(claimToken);
      console.log({events});
      await this.processEvents(events);
      await setTimeout(this.interval);
    }
  }

  // processing failed
  // mark the event as failed
  async markEventUnsent(event) {
    event.markAsFailed();
    await update(event);
    logger.info(`Marked outbox event unsent ${event}`);
  }

  // processing complete
  // mark the event as completed
  async markEventComplete(event) {
    event.markAsComplete();
    await update(event);
    logger.info(`Marked outbox event as complete ${event._id}`);
  }

  async sendEvent(event) {
    const { listenerId: topic, event: data } = event;
    logger.info(`Send outbox event to ${topic}`);
    try {
      await publish(topic, data);
      await this.markEventComplete(event);
    } catch (ex) {
      logger.error(`Error sending outbox event to topic ${topic}`);
      logger.error(ex.message);
      this.markEventUnsent(event);
    }
  }

  async processEvents(events) {
    logger.info("process outbox events", events);
    await Promise.all(events.map((event) => this.sendEvent(event)));
    logger.info("all outbox events processed");
  }

  start() {
    // TODO: check if there are any hanging processes (status: "PROCESSING") and process these immediately
    logger.info("starting outbox subscriber");
    this.running = true;
    this.poll();
  }

  stop() {
    logger.info("stopping outbox subscriber");
    this.running = false;
  }
}
