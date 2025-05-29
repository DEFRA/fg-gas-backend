import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { setTimeout } from "node:timers/promises";
import { config } from "./config.js";
import { wrapTraceParent } from "./event-trace-parent.js";
import { logger } from "./logger.js";

export class SqsSubscriber {
  constructor(options) {
    this.queueUrl = options.queueUrl;
    this.onMessage = options.onMessage;
    this.isRunning = false;

    const awsConfig = {
      region: config.region,
      endpoint: config.awsEndpointUrl,
    };

    if (config.awsEndpointUrl) {
      awsConfig.credentials = {
        accessKeyId: "test",
        secretAccessKey: "test",
      };
    }

    this.sqsClient = new SQSClient(awsConfig);
  }

  async start() {
    this.isRunning = true;
    await this.poll();
    logger.info(`Started polling SQS queue: ${this.queueUrl}`);
  }

  async stop() {
    this.isRunning = false;
    logger.info(`Stopped polling SQS queue: ${this.queueUrl}`);
  }

  async processMessage(message) {
    const messageBody = JSON.parse(message.Body);
    wrapTraceParent(() => this.onMessage(messageBody), messageBody.traceparent);
  }

  async poll() {
    while (this.isRunning) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            AttributeNames: ["All"],
            MessageAttributeNames: ["All"],
          }),
        );

        if (response.Messages && response.Messages.length > 0) {
          await Promise.all(
            response.Messages.map(async (message) => {
              try {
                logger.info(`Processing SQS message ${message.MessageId}`);
                await this.processMessage(message);
                await this.deleteMessage(message);
              } catch (err) {
                logger.error(
                  `Error processing SQS message ${message.MessageId}: ${err.message}`,
                );
              }
            }),
          );
        }
      } catch (err) {
        logger.error(`Error polling SQS queue: ${this.queueUrl}`);
        await setTimeout(30000);
      }
    }
  }

  async deleteMessage(message) {
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}
