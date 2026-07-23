import { up } from "migrate-mongo";
import { registerInternalCommandHandler } from "../common/internal-command-bus.js";
import { internalCommandTypes } from "../common/internal-command-types.js";
import { logger } from "../common/logger.js";
import { db, mongoClient } from "../common/mongo-client.js";
import { applicationStatusRoute } from "./routes/application-status.route.js";
import { createGrantRoute } from "./routes/create-grant.route.js";
import { findGrantByCodeRoute } from "./routes/find-grant-by-code.route.js";
import { findGrantsRoute } from "./routes/find-grants.route.js";
import {
  invokeGetActionRoute,
  invokePostActionRoute,
} from "./routes/invoke-action.route.js";
import { replaceGrantRoute } from "./routes/replace-grant.route.js";
import { submitApplicationRoute } from "./routes/submit-application.route.js";
import { agreementStatusUpdatedSubscriber } from "./subscribers/agreement-status-updated.subscriber.js";
import { caseStatusUpdatedSubscriber } from "./subscribers/case-status-updated.subscriber.js";
import { configVersionUpdatedSubscriber } from "./subscribers/config-version-updated.subscriber.js";
import { InboxSubscriber } from "./subscribers/inbox.subscriber.js";
import { OutboxSubscriber } from "./subscribers/outbox.subscriber.js";
import {
  messageSource,
  saveInboxMessageUseCase,
} from "./use-cases/save-inbox-message.use-case.js";

export const grants = {
  name: "grants",
  async register(server) {
    registerInternalCommandHandler(
      internalCommandTypes.AGREEMENT_STATUS_UPDATED,
      (event) => saveInboxMessageUseCase(event, messageSource.AgreementService),
    );

    logger.info("Running migrations");
    const migrated = await up(db, mongoClient);
    migrated.forEach((fileName) => logger.info(`Migrated: ${fileName}`));
    logger.info("Finished running migrations");

    const outboxSubscriber = new OutboxSubscriber();
    const inboxSubscriber = new InboxSubscriber();

    server.events.on("start", async () => {
      agreementStatusUpdatedSubscriber.start();
      caseStatusUpdatedSubscriber.start();
      configVersionUpdatedSubscriber.start();
      outboxSubscriber.start();
      inboxSubscriber.start();
    });

    server.events.on("stop", async () => {
      agreementStatusUpdatedSubscriber.stop();
      caseStatusUpdatedSubscriber.stop();
      configVersionUpdatedSubscriber.stop();
      outboxSubscriber.stop();
      inboxSubscriber.stop();
    });

    server.route([
      createGrantRoute,
      replaceGrantRoute,
      findGrantsRoute,
      findGrantByCodeRoute,
      invokeGetActionRoute,
      invokePostActionRoute,
      submitApplicationRoute,
      applicationStatusRoute,
    ]);
  },
};
