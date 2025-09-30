import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { fetchPendingEvents } from "../grants/repositories/event-publication.respository.js";
import { logger } from "./logger.js";
import { db } from "./mongo-client.js";
import { publish } from "./sns-client.js";

const outbox = "event_publication_outbox";

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
      await this.processEvents(events);
      await setTimeout(this.interval);
    }
  }

  // processing failed
  // mark the event as failed
  // update completionAttempts and any other data
  // reset the claimToken and claimedAt
  async markEventUnsent(event) {
    const completionAttempts = event.completionAttempts + 1;
    await db
      .collection(outbox)
      .updateOne(
        { _id: event._id },
        {
          status: "FAILED",
          claimToken: null,
          claimedAt: null,
          completionAttempts,
        },
      );
    logger.info(`Marked event unsent ${event}`);
  }

  // processing complete
  // mark the event as completed
  // set the status and completionDate
  // reset claimToken and claimedAt
  async markEventComplete(event) {
    await db.collection(outbox).updateOne(
      {
        _id: event._id,
      },
      {
        $set: {
          status: "COMPLETED",
          claimToken: null,
          claimedAt: null,
          completionDate: new Date().toISOString(),
        },
      },
    );
    logger.info(`Marked event as complete ${event._id}`);
  }

  async sendEvent(event) {
    const { listenerId: topic, event: data } = event;
    logger.info(`Send event to ${topic}`);
    try {
      await publish(topic, data);
      await this.markEventComplete(event);
    } catch (ex) {
      logger.error(`Error sending event to topic ${topic}`);
      logger.error(ex.message);
      this.markEventUnsent(event);
    }
  }

  async processEvents(events) {
    logger.info("process events", events);
    await Promise.all(events.map((event) => this.sendEvent(event)));
    logger.info("all events processed");
  }

  start() {
    // TODO: check is there are any hanging processes (status: "PROCESSING") and process these immediately
    logger.info("starting outbox subscriber");
    this.running = true;
    this.poll();
  }

  stop() {
    logger.info("stopping outbox subscriber");
    this.running = false;
  }
}
