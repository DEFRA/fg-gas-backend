import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { setTimeout } from "node:timers/promises";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { withTraceParent } from "./trace-parent.js";

export class SqsSubscriber {
  constructor(options) {
    this.queueUrl = options.queueUrl;
    this.onMessage = options.onMessage;
    this.isRunning = false;

    this.sqsClient = new SQSClient({
      region: config.region,
      endpoint: config.awsEndpointUrl,
    });
  }

  async start() {
    this.isRunning = true;
    await this.poll();
  }

  async stop() {
    this.isRunning = false;
  }

  async poll() {
    logger.info(`Started polling SQS queue: ${this.queueUrl}`);

    while (this.isRunning) {
      try {
        const messages = await this.getMessages();
        await Promise.all(messages.map((m) => this.processMessage(m)));
      } catch (err) {
        logger.error(
          `Error polling SQS queue ${this.queueUrl}: ${err.message}`,
        );
        await setTimeout(30000);
      }
    }

    logger.info(`Stopped polling SQS queue: ${this.queueUrl}`);
  }

  async processMessage(message) {
    logger.info(`Processing SQS message ${message.MessageId}`);

    try {
      const body = JSON.parse(message.Body);
      await withTraceParent(body.traceparent, () => this.onMessage(body));
      await this.deleteMessage(message);
    } catch (err) {
      logger.error(
        { err },
        `Error processing SQS message ${message.MessageId}`,
      );
    }
  }

  async getMessages() {
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      }),
    );

    return response.Messages || [];
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
