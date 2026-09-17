import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { getOrCreateTraceParent, SqsSubscriber } from "./sqs-subscriber.js";
import { getTraceParent } from "./trace-parent.js";

vi.mock("./logger.js");

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

describe("getMessages", () => {
  it("requests messages with system and message attributes", async () => {
    consumer.sqsClient.send.mockResolvedValueOnce({ Messages: [] });

    await consumer.getMessages();

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: consumer.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"],
    });
  });

  it("returns the messages received", async () => {
    const messages = [{ MessageId: "msg-1" }];
    consumer.sqsClient.send.mockResolvedValueOnce({ Messages: messages });

    expect(await consumer.getMessages()).toEqual(messages);
  });

  it("returns an empty list when the queue is empty", async () => {
    consumer.sqsClient.send.mockResolvedValueOnce({});

    expect(await consumer.getMessages()).toEqual([]);
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

const W3C_TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

const sqsMessage = (body, overrides = {}) => ({
  MessageId: "msg-1",
  ReceiptHandle: "receipt-1",
  Body: JSON.stringify(body),
  Attributes: { SentTimestamp: "1758106800000" },
  MessageAttributes: { grant: { StringValue: "woodland" } },
  ...overrides,
});

describe("getOrCreateTraceParent", () => {
  it("keeps the traceparent the body carries", () => {
    expect(getOrCreateTraceParent({ traceparent: "existing-trace" })).toBe(
      "existing-trace",
    );
  });

  it.each([
    ["an array body, as the Config Broker publishes", []],
    ["a body with no traceparent", { id: "1" }],
    ["an empty traceparent", { traceparent: "" }],
    ["no body at all", undefined],
  ])("generates a W3C traceparent for %s", (_, body) => {
    expect(getOrCreateTraceParent(body)).toMatch(W3C_TRACEPARENT);
  });

  it("generates a different traceparent each time", () => {
    expect(getOrCreateTraceParent([])).not.toBe(getOrCreateTraceParent([]));
  });
});

describe("processMessage", () => {
  let traceParentDuringOnMessage;

  beforeEach(() => {
    traceParentDuringOnMessage = null;
    onMessage.mockImplementation(async () => {
      traceParentDuringOnMessage = getTraceParent();
    });
  });

  it("runs the handler under the traceparent the body carries", async () => {
    await consumer.processMessage(
      sqsMessage({ id: "1", traceparent: "existing-trace" }),
    );

    expect(traceParentDuringOnMessage).toBe("existing-trace");
  });

  // The Config Broker publishes a bare manifest array, so there is nothing to inherit.
  it("runs the handler under a generated traceparent when the body carries none", async () => {
    await consumer.processMessage(sqsMessage(["woodland/1.0.0/gas/gas.json"]));

    expect(traceParentDuringOnMessage).toMatch(W3C_TRACEPARENT);
  });

  it("passes the body, message attributes and message metadata to the handler", async () => {
    await consumer.processMessage(sqsMessage(["woodland/1.0.0/gas/gas.json"]));

    expect(onMessage).toHaveBeenCalledWith(
      ["woodland/1.0.0/gas/gas.json"],
      { grant: { StringValue: "woodland" } },
      { messageId: "msg-1", sentTimeStamp: "1758106800000" },
    );
  });

  // A message is still processed when SQS returns no system attributes, rather
  // than throwing inside the try and redelivering forever.
  it("passes an undefined sent timestamp when there are no system attributes", async () => {
    const message = sqsMessage({ id: "1" });
    delete message.Attributes;

    await consumer.processMessage(message);

    expect(onMessage).toHaveBeenCalledWith(
      { id: "1" },
      { grant: { StringValue: "woodland" } },
      { messageId: "msg-1", sentTimeStamp: undefined },
    );
    expect(DeleteMessageCommand).toHaveBeenCalled();
  });

  it("deletes the message once the handler succeeds", async () => {
    await consumer.processMessage(sqsMessage({ id: "1" }));

    expect(DeleteMessageCommand).toHaveBeenCalledWith({
      QueueUrl: consumer.queueUrl,
      ReceiptHandle: "receipt-1",
    });
  });

  it("leaves the message on the queue when the handler throws", async () => {
    onMessage.mockRejectedValueOnce(new Error("handler failed"));

    await consumer.processMessage(sqsMessage({ id: "1" }));

    expect(DeleteMessageCommand).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
