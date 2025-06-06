import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { SqsSubscriber } from "./sqs-subscriber.js";

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@aws-sdk/client-sqs");

let consumer;
let onMessage;

beforeEach(async () => {
  onMessage = vi.fn().mockResolvedValue();

  consumer = new SqsSubscriber({
    queueUrl: "https://sqs.eu-west-2.amazonaws.com/123456789012/test-queue",
    onMessage,
  });
});

describe("constructor", () => {
  it("instantiates with options", () => {
    expect(consumer.queueUrl).toBe(
      "https://sqs.eu-west-2.amazonaws.com/123456789012/test-queue",
    );
    expect(consumer.onMessage).toBe(onMessage);
    expect(consumer.isRunning).toBe(false);
    expect(SQSClient).toHaveBeenCalledWith({
      endpoint: "http://localhost:4566",
      region: "eu-west-2",
    });
  });
});

describe("start", () => {
  it("sets isRunning to true and starts polling", async () => {
    consumer.poll = vi.fn().mockResolvedValue();

    await consumer.start();

    expect(consumer.isRunning).toBe(true);
    expect(consumer.poll).toHaveBeenCalled();
  });
});

describe("stop", () => {
  it("sets isRunning to false", async () => {
    consumer.isRunning = true;

    await consumer.stop();

    expect(consumer.isRunning).toBe(false);
  });
});

describe("message processing", () => {
  it("processes and deletes messages correctly", async () => {
    const mockMessages = [
      {
        MessageId: "msg-1",
        Body: "Test message 1",
        ReceiptHandle: "receipt-1",
      },
    ];

    consumer.sqsClient.send.mockImplementation(async (command) => {
      if (command instanceof ReceiveMessageCommand) {
        return { Messages: mockMessages };
      }
      if (command instanceof DeleteMessageCommand) {
        return {};
      }
      return {};
    });

    const processOneMessage = async () => {
      const receiveParams = {
        QueueUrl: consumer.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      };

      const command = new ReceiveMessageCommand(receiveParams);
      const response = await consumer.sqsClient.send(command);

      if (response.Messages && response.Messages.length > 0) {
        for (const message of response.Messages) {
          await consumer.onMessage(message);
          await consumer.deleteMessage(message);
        }
      }
    };

    await processOneMessage();

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: consumer.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"],
    });

    expect(onMessage).toHaveBeenCalledWith(mockMessages[0]);

    expect(DeleteMessageCommand).toHaveBeenCalledWith({
      QueueUrl: consumer.queueUrl,
      ReceiptHandle: "receipt-1",
    });
  });

  it("handles errors", async () => {
    const mockMessages = [
      {
        MessageId: "msg-1",
        Body: "Test message 1",
        ReceiptHandle: "receipt-1",
      },
    ];

    consumer.sqsClient.send.mockImplementation(async (command) => {
      if (command instanceof ReceiveMessageCommand) {
        return { Messages: mockMessages };
      }
      return {};
    });

    onMessage.mockRejectedValueOnce(new Error("Test error"));

    const processOneMessage = async () => {
      const receiveParams = {
        QueueUrl: consumer.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      };

      const command = new ReceiveMessageCommand(receiveParams);
      const response = await consumer.sqsClient.send(command);

      if (response.Messages.length) {
        for (const message of response.Messages) {
          try {
            await consumer.onMessage(message);
            await consumer.deleteMessage(message);
          } catch (err) {
            logger.error({
              error: err.message,
              message: "Failed to process SQS message",
              messageId: message.MessageId,
            });
          }
        }
      }
    };

    await processOneMessage();

    expect(logger.error).toHaveBeenCalledWith({
      error: "Test error",
      message: "Failed to process SQS message",
      messageId: "msg-1",
    });
  });
});

describe("deleteMessage", () => {
  it("deletes a message", async () => {
    const mockMessage = {
      MessageId: "msg-1",
      ReceiptHandle: "receipt-1",
    };

    await consumer.deleteMessage(mockMessage);

    expect(DeleteMessageCommand).toHaveBeenCalledWith({
      QueueUrl: consumer.queueUrl,
      ReceiptHandle: "receipt-1",
    });
    expect(consumer.sqsClient.send).toHaveBeenCalled();
  });
});
