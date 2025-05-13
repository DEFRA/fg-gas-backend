import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { config } from "./config.js";

export default class SqsConsumer {
  constructor(server, options) {
    this.server = server;
    this.queueUrl = options.queueUrl;
    this.handleMessage = options.handleMessage;
    this.isRunning = false;

    // Configure SQS client
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
    this.server.logger.info(`Started polling SQS queue: ${this.queueUrl}`);
  }

  async stop() {
    this.isRunning = false;
    this.server.logger.info(`Stopped polling SQS queue: ${this.queueUrl}`);
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
                // Process the message
                await this.handleMessage(message);
                // Delete the message after successful processing
                await this.deleteMessage(message);
              } catch (err) {
                this.server.logger.error({
                  error: err.message,
                  message: `Failed to process SQS message ID: ${message.MessageId} - ${err.message}`,
                  messageId: message.MessageId,
                });
              }
            }),
          );
        }
      } catch (err) {
        this.server.logger.error({
          error: err.message,
          message: "Error polling SQS queue",
        });
        // Add a small delay before retrying on error
        await new Promise((resolve) => setTimeout(resolve, 30000));
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
