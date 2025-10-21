import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import {
  fetchPendingEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../grants/repositories/inbox.respository.js";
import { approveApplicationUseCase } from "../grants/use-cases/approve-application.use-case.js";
import { logger } from "./logger.js";
import { withTraceParent } from "./trace-parent.js";

const useCaseMap = {
  "io.onsite.agreement.offer.offered": approveApplicationUseCase,
};

/*
 * Class to poll the event_publication_inbox table
 */
export class InboxSubscriber {
  constructor(interval) {
    this.interval = interval;
    this.running = false;
  }

  async poll() {
    while (this.running) {
      const claimToken = randomUUID();
      const events = await fetchPendingEvents(claimToken);
      await this.processEvents(events);
      // move resubmitted events to published status
      await this.processResubmittedEvents();
      // move failed events to resubmitted status
      await this.processFailedEvents();
      // DLQ
      await this.processDeadEvents();

      await setTimeout(this.interval);
    }
  }

  async processDeadEvents() {
    logger.info("Processing dead inbox events");
    const results = await updateDeadEvents();
    logger.info(`Updated ${results?.modifiedCount} dead inbox events`);
  }

  async processResubmittedEvents() {
    logger.info("Processing resubmitted inbox events");
    const results = await updateResubmittedEvents();
    logger.info(`Updated ${results?.modifiedCount} resubmitted inbox events`);
  }

  async processFailedEvents() {
    logger.info("Processing failed inbox events");
    const results = await updateFailedEvents();
    logger.info(`Updated ${results?.modifiedCount} failed inbox events`);
  }

  // processing failed
  // mark the event as failed
  async markEventFailed(inboxEvent) {
    inboxEvent.markAsFailed();
    await update(inboxEvent);
    logger.info(`Marked inbox event unsent ${inboxEvent.messageId}`);
  }

  // processing complete
  // mark the event as completed
  async markEventComplete(inboxEvent) {
    inboxEvent.markAsComplete();
    await update(inboxEvent);
    logger.info(`Marked inbox event as complete ${inboxEvent.messageId}`);
  }

  async mapEventToUseCase(msg) {
    const { type, event, messageId } = msg;
    logger.info(`Handler event for inbox message ${type}:${messageId}`);
    try {
      const fn = useCaseMap[type];
      if (fn) {
        // pass along traceparent from incoming event
        await withTraceParent(event.traceparent, async () => fn(event.data));
        await this.markEventComplete(msg);
      } else {
        await this.markEventFailed(msg);
      }
    } catch (ex) {
      logger.error(
        `Error handling event for inbox message ${type}:${messageId}`,
      );
      logger.error(ex.message);
      await this.markEventFailed(msg);
    }
  }

  async processEvents(events) {
    logger.info(`Processing ${events.length} inbox messages`);
    await Promise.all(events.map((event) => this.mapEventToUseCase(event)));
    logger.info("All inbox messages processed");
  }

  start() {
    // TODO: check if there are any hanging processes (status: "PROCESSING") and process these immediately
    logger.info("starting inbox subscriber");
    this.running = true;
    this.poll();
  }

  stop() {
    logger.info("stopping inbox subscriber");
    this.running = false;
  }
}
