import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  fetchPendingEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../grants/repositories/outbox.respository.js";
import { logger } from "./logger.js";
import { publish } from "./sns-client.js";

/*
 * Class to poll the event_publication_outbox table
 */
export class OutboxSubscriber {
  constructor(interval, includeResubmissions) {
    this.interval = interval;
    this.running = false;
    this.includeResubmissions = includeResubmissions;
  }

  async poll() {
    while (this.running) {
      const claimToken = randomUUID();
      const pendingEvents = await fetchPendingEvents(claimToken);

      if (pendingEvents.length > 0) {
        logger.info(`Processing ${pendingEvents.length} pending events`);
        await this.processEvents(pendingEvents);
      }

      // move resubmitted events to published status
      await this.processResubmittedEvents();

      // move failed events to resubmitted status
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

  async processHangingEvents() {
    // called at start up to clear any hanging events from a previous start
    // how do we ensure that the event isn't being processed by another instance?
    // can we store the instance id with the claim token,
    // check that the instance id is still valid/up?
    logger.warn(
      'TODO: check if there are any hanging processes (status: "PROCESSING") and process these immediately',
    );
  }

  // processing failed
  // mark the event as failed
  async markEventUnsent(event) {
    event.markAsFailed();
    await update(event);
    logger.info(`Marked outbox event unsent ${event._id}`);
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
    logger.info(`Processing ${events.length} outbox events.`);
    await Promise.all(events.map((event) => this.sendEvent(event)));
    logger.info("All outbox events processed.");
  }

  async start() {
    // TODO: check if there are any hanging processes (status: "PROCESSING") and process these immediately
    logger.info("starting outbox subscriber");
    await this.processHangingEvents();
    this.running = true;
    this.poll();
  }

  stop() {
    logger.info("stopping outbox subscriber");
    this.running = false;
  }
}
