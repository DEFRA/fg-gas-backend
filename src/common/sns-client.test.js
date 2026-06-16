import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: vi.fn(),
  PublishCommand: vi.fn(),
}));

describe("publish", () => {
  it("publishes a message to a topic, including MessageGroupId only for FIFO topics", async () => {
    const send = vi.fn();

    SNSClient.mockImplementation(function () {
      return { send };
    });

    PublishCommand.mockImplementation(function (params) {
      return params;
    });

    const { publish } = await import("./sns-client.js");

    const fifoArn = "arn:aws:sns:us-east-1:123456789012:MyTopic.fifo";
    await publish(fifoArn, { key: "value" }, "mock-message-id");
    expect(PublishCommand).toHaveBeenCalledWith({
      TopicArn: fifoArn,
      Message: '{"key":"value"}',
      MessageGroupId: "mock-message-id",
    });

    const standardArn = "arn:aws:sns:us-east-1:123456789012:MyTopic";
    await publish(standardArn, { key: "value" }, "mock-message-id");
    expect(PublishCommand).toHaveBeenCalledWith({
      TopicArn: standardArn,
      Message: '{"key":"value"}',
    });
  });
});
