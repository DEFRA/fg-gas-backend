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

vi.mock("../../common/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

const mockSaveInboxMessageUseCase = vi.fn();
vi.mock("../use-cases/save-inbox-message.use-case.js", () => ({
  messageSource: { ConfigBroker: "CONFIG_BROKER" },
  saveInboxMessageUseCase: (...args) => mockSaveInboxMessageUseCase(...args),
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

  it("should call saveInboxMessageUseCase with CONFIG_BROKER source", async () => {
    await import("./config-version-updated.subscriber.js");

    const message = {
      id: "msg-123",
      type: "config.version.published",
      time: new Date().toISOString(),
      data: { grantCode: "woodland", version: "1.2.3", status: "active" },
    };

    await capturedOnMessage(message);

    expect(mockSaveInboxMessageUseCase).toHaveBeenCalledWith(
      message,
      "CONFIG_BROKER",
    );
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
