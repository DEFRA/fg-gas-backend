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
import { handleAgreementStatusChangeUseCase } from "../use-cases/handle-agreement-status-change.use-case.js";

export const useCaseMap = {
  "io.onsite.agreement.offer.offered": handleAgreementStatusChangeUseCase,
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

      if (handler) {
        await withTraceParent(traceparent, async () => handler(msg));
      } else if (event.data.currentStatus && source) {
        // status transition/update
        await withTraceParent(traceparent, async () =>
          applyExternalStateChange({
            sourceSystem: source,
            clientRef: data.caseRef,
            code: data.workflowCode,
            externalRequestedState: data.currentStatus,
            eventData: data,
          }),
        );
      } else {
        throw new Error(`Unable to handle inbox message ${msg.id}`);
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
