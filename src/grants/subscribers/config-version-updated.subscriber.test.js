import { describe, expect, it, vi } from "vitest";

vi.mock("../../common/config.js", () => ({
  config: {
    region: "eu-west-2",
    awsEndpointUrl: "http://localhost:4566",
    sqs: {
      configVersionQueueUrl:
        "http://sqs.eu-west-2.localhost:4566/000000000000/gas__sqs__config_version_updated_fifo.fifo",
    },
  },
}));

const mockSaveInboxMessageUseCase = vi.fn();
vi.mock("../use-cases/save-inbox-message.use-case.js", () => ({
  messageSource: { ConfigBroker: "CONFIG_BROKER" },
  saveInboxMessageUseCase: (...args) => mockSaveInboxMessageUseCase(...args),
}));

vi.mock("../../common/sqs-subscriber.js", () => ({
  SqsSubscriber: class {
    constructor(opts) {
      this.queueUrl = opts.queueUrl;
      this.onMessage = opts.onMessage;
    }

    start() {}
    stop() {}
  },
}));

describe("configVersionUpdatedSubscriber", () => {
  it("should be configured with the correct queue URL", async () => {
    const { configVersionUpdatedSubscriber } = await import(
      "./config-version-updated.subscriber.js"
    );
    expect(configVersionUpdatedSubscriber.queueUrl).toBe(
      "http://sqs.eu-west-2.localhost:4566/000000000000/gas__sqs__config_version_updated_fifo.fifo",
    );
  });

  it("should call saveInboxMessageUseCase with CONFIG_BROKER source", async () => {
    const { configVersionUpdatedSubscriber } = await import(
      "./config-version-updated.subscriber.js"
    );

    const message = {
      id: "msg-123",
      type: "config.version.published",
      time: new Date().toISOString(),
      data: { grantCode: "woodland", version: "1.2.3", status: "active" },
    };

    await configVersionUpdatedSubscriber.onMessage(message);

    expect(mockSaveInboxMessageUseCase).toHaveBeenCalledWith(
      message,
      "CONFIG_BROKER",
    );
  });
});
