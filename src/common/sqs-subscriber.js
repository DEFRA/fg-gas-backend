import { setTimeout } from "timers/promises";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { config } from "./config.js";
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

  async poll() {
    while (this.isRunning) {
      try {
        const receiveParams = {
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          AttributeNames: ["All"],
          MessageAttributeNames: ["All"],
        };

        const command = new ReceiveMessageCommand(receiveParams);
        const response = await this.sqsClient.send(command);

        if (response.Messages && response.Messages.length > 0) {
          await Promise.all(
            response.Messages.map(async (message) => {
              try {
                await this.onMessage(message);
                await this.deleteMessage(message);
              } catch (err) {
                logger.error({
                  error: err.message,
                  message: `Failed to process SQS message ID: ${message.MessageId} - ${err.message}`,
                  messageId: message.MessageId,
                });
              }
            }),
          );
        }
      } catch (err) {
        logger.error({
          error: err.message,
          message: "Error polling SQS queue",
        });
        await setTimeout(30000);
      }
    }
  }

  async deleteMessage(message) {
    const deleteParams = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.ReceiptHandle,
    };

    const command = new DeleteMessageCommand(deleteParams);
    await this.sqsClient.send(command);
  }
}
