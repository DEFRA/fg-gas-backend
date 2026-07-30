import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { SqsSubscriber } from "../../common/sqs-subscriber.js";
import { processConfigVersionUseCase } from "../use-cases/process-config-version.use-case.js";

const queueUrl = config.sqs.configVersionQueueUrl;

const extractStringAttribute = (attributes, key) =>
  attributes?.[key]?.StringValue;

const subscriber = queueUrl
  ? new SqsSubscriber({
      queueUrl,
      async onMessage(body, messageAttributes) {
        const grantCode = extractStringAttribute(messageAttributes, "grant");
        const version = extractStringAttribute(messageAttributes, "version");
        const status = extractStringAttribute(messageAttributes, "status");
        const manifest = body;

        logger.info(
          `Received config version update: ${grantCode}@${version} (${status})`,
        );

        await processConfigVersionUseCase({
          grantCode,
          version,
          status,
          manifest,
        });
      },
    })
  : null;

export const configVersionUpdatedSubscriber = {
  start() {
    if (!subscriber) {
      logger.warn(
        "Config version queue URL not configured — subscriber disabled",
      );
      return;
    }
    subscriber.start();
  },
  stop() {
    subscriber?.stop();
  },
};
