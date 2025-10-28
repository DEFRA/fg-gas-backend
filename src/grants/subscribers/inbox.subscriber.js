import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTraceParent } from "../../common/trace-parent.js";
import {
  claimEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/inbox.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";

export const useCaseMap = {
  "io.onsite.agreement.offer.offered": approveApplicationUseCase,
};

export class InboxSubscriber {
  constructor() {
    this.interval = config.inbox.inboxPollMs;
    this.running = false;
  }

  async poll() {
    while (this.running) {
      const claimToken = randomUUID();
      const events = await claimEvents(claimToken);
      await this.processEvents(events);
      await this.processResubmittedEvents();
      await this.processFailedEvents();
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

  async handleEvent(msg) {
    const { type, event, traceparent, messageId } = msg;
    logger.info(`Handle event for inbox message ${type}:${messageId}`);
    try {
      const { data } = event;

      if (event.data.currentStatus) {
        // status transition/update
        await withTraceParent(traceparent, async () =>
          applyExternalStateChange({
            sourceSystem: "CW",
            clientRef: data.caseRef,
            code: data.workflowCode,
            externalRequestedState: data.currentStatus,
            eventData: data,
          }),
        );
      } else {
        // map to a usecase
        const fn = useCaseMap[type];
        if (fn) {
          await withTraceParent(traceparent, async () => fn(data));
        }
      }

      await this.markEventComplete(msg);
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
    await Promise.all(events.map((event) => this.handleEvent(event)));
    logger.info("All inbox messages processed");
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
