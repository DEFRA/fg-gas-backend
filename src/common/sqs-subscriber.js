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

  async poll() {
    while (this.isRunning) {
      try {
        const messages = await this.getMessages();
        await Promise.all(messages.map(this.processMessage));
      } catch (err) {
        logger.error(`Error polling SQS queue: ${this.queueUrl}`);
        await setTimeout(30000);
      }
    }
  }

  async processMessage(message) {
    logger.info(`Processing SQS message ${message.MessageId}`);

    try {
      const body = JSON.parse(message.Body);
      await withTraceParent(body.traceparent, () => this.onMessage(body));
      await this.deleteMessage(message);
    } catch (err) {
      logger.error(
        `Error processing SQS message ${message.MessageId}: ${err.message}`,
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
