import { describe, expect, it, vi } from "vitest";

const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock("../../common/config.js", () => ({
  config: {
    region: "eu-west-2",
    awsEndpointUrl: "http://localhost:4566",
    sqs: {
      configVersionQueueUrl:
        "http://sqs.eu-west-2.localhost:4566/000000000000/gas__sqs__config_version_updated",
    },
  },
}));

vi.mock("../../common/logger.js");

const mockSaveConfigVersionInboxMessage = vi.fn();
vi.mock("../use-cases/save-config-version-inbox-message.use-case.js", () => ({
  saveConfigVersionInboxMessageUseCase: (...args) =>
    mockSaveConfigVersionInboxMessage(...args),
}));

// Kept mocked so the subscriber can be proven not to apply the config itself.
const mockProcessConfigVersion = vi.fn();
vi.mock("../use-cases/process-config-version.use-case.js", () => ({
  processConfigVersionUseCase: (...args) => mockProcessConfigVersion(...args),
}));

let capturedOnMessage;
vi.mock("../../common/sqs-subscriber.js", () => ({
  SqsSubscriber: class {
    constructor(opts) {
      this.queueUrl = opts.queueUrl;
      this.onMessage = opts.onMessage;
      capturedOnMessage = opts.onMessage;
    }

    start = mockStart;
    stop = mockStop;
  },
}));

describe("configVersionUpdatedSubscriber", () => {
  it("should delegate start to the underlying SqsSubscriber", async () => {
    const { configVersionUpdatedSubscriber } =
      await import("./config-version-updated.subscriber.js");
    configVersionUpdatedSubscriber.start();
    expect(mockStart).toHaveBeenCalled();
  });

  it("should delegate stop to the underlying SqsSubscriber", async () => {
    const { configVersionUpdatedSubscriber } =
      await import("./config-version-updated.subscriber.js");
    configVersionUpdatedSubscriber.stop();
    expect(mockStop).toHaveBeenCalled();
  });

  it("should pass the manifest, attributes and metadata to the inbox adapter", async () => {
    await import("./config-version-updated.subscriber.js");

    const body = [
      "woodland/1.2.3/gas/gas.json",
      "woodland/1.2.3/metadata.json",
    ];
    const messageAttributes = {
      grant: { DataType: "String", StringValue: "woodland" },
      version: { DataType: "String", StringValue: "1.2.3" },
      status: { DataType: "String", StringValue: "active" },
    };
    const metadata = { messageId: "msg-1", sentTimeStamp: "1758106800000" };

    await capturedOnMessage(body, messageAttributes, metadata);

    expect(mockSaveConfigVersionInboxMessage).toHaveBeenCalledWith(
      body,
      messageAttributes,
      metadata,
    );
  });

  // AC1: the event is written to the Inbox and not applied on receipt.
  it("should not apply the config version on receipt", async () => {
    await import("./config-version-updated.subscriber.js");

    await capturedOnMessage([], {}, {});

    expect(mockProcessConfigVersion).not.toHaveBeenCalled();
  });
});

describe("configVersionUpdatedSubscriber (no queue URL)", () => {
  it("should not throw when started without a queue URL", async () => {
    vi.doMock("../../common/config.js", () => ({
      config: {
        region: "eu-west-2",
        awsEndpointUrl: "http://localhost:4566",
        sqs: { configVersionQueueUrl: undefined },
      },
    }));

    const { configVersionUpdatedSubscriber } =
      await import("./config-version-updated.subscriber.js");

    expect(() => configVersionUpdatedSubscriber.start()).not.toThrow();
    expect(() => configVersionUpdatedSubscriber.stop()).not.toThrow();
  });
});
