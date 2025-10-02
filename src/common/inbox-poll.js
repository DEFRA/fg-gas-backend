import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { logger } from "./logger.js";
import { fetchPendingEvents, update } from "../grants/repositories/event-publication-inbox.respository.js";
import { approveApplicationUseCase } from "../grants/use-cases/approve-application.use-case.js";


// when polling do we map the event to a method with a standard map?
// map message type to function/method ???? 
const useCaseMap = {
  "io.onsite.agreement.offer.offered": approveApplicationUseCase
  // "io.onsite.agreement.offer.offered": "approveApplicationUseCase"
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
      await setTimeout(this.interval);
    }
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

  async mapEvent(msg) {
    const { type, event, messageId } = msg;
    logger.info(`handler event for inbox message ${type}:${messageId}`);
    try {
      const fn = useCaseMap[type];
      if(fn) {
        // we can eval the functionNamesafe because we're mapping to the name above
        // or we can import all the use-cases we need and call them safely
        // await eval(fn)(event.data);
        await fn(event.data);
        await this.markEventComplete(msg);
      } else {
        await this.markEventFailed(msg);
      }
    } catch (ex) {
      logger.error(`Error handling event for inbox message ${type}:${messageId}`);
      logger.error(ex.message);
      await this.markEventFailed(msg);
    }
  }

  async processEvents(events) {
    logger.info("process inbox messages", events);
    await Promise.all(events.map((event) => this.mapEvent(event)));
    logger.info("all inbox messages processed");
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
