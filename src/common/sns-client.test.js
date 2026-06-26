import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: vi.fn(),
  PublishCommand: vi.fn(),
}));

describe("publish", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("publishes a message to a non-fifo topic", async () => {
    const topicArn = "arn:aws:sns:us-east-1:123456789012:MyTopic";

    const message = {
      key: "value",
    };

    const send = vi.fn();

    SNSClient.mockImplementation(function () {
      return { send };
    });

    PublishCommand.mockImplementation(function (params) {
      return params;
    });

    const { publish } = await import("./sns-client.js");

    await publish(topicArn, message);

    expect(PublishCommand).toHaveBeenCalledWith({
      TopicArn: topicArn,
      Message: '{"key":"value"}',
    });

    expect(send).toHaveBeenCalledWith({
      TopicArn: topicArn,
      Message: '{"key":"value"}',
    });
  });

  it("publishes a message to a fifo topic", async () => {
    const topicArn = "arn:aws:sns:us-east-1:123456789012:MyTopic.fifo";

    const message = {
      key: "value",
    };

    const send = vi.fn();

    SNSClient.mockImplementation(function () {
      return { send };
    });

    PublishCommand.mockImplementation(function (params) {
      return params;
    });

    const { publish } = await import("./sns-client.js");

    await publish(topicArn, message, "mock-message-id");

    expect(PublishCommand).toHaveBeenCalledWith({
      TopicArn: topicArn,
      Message: '{"key":"value"}',
      MessageGroupId: "mock-message-id",
    });

    expect(send).toHaveBeenCalledWith({
      TopicArn: topicArn,
      Message: '{"key":"value"}',
      MessageGroupId: "mock-message-id",
    });
  });
});
