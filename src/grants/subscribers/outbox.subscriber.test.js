import { AsyncLocalStorage } from "node:async_hooks";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { logger } from "../../common/logger.js";
import { publish } from "../../common/sns-client.js";
import { Outbox } from "../models/outbox.js";
import {
  claimEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/outbox.repository.js";
import { OutboxSubscriber } from "./outbox.subscriber.js";

vi.mock("../../common/sns-client.js");
vi.mock("../repositories/outbox.repository.js");

describe("outbox.subscriber", () => {
  beforeEach(() => {
    updateDeadEvents.mockResolvedValue({ modifiedCount: 1 });
    updateResubmittedEvents.mockResolvedValue({ modifiedCount: 1 });
    updateFailedEvents.mockResolvedValue({ modifiedCount: 1 });
    publish.mockResolvedValue(1);
    claimEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("should start polling on start()", async () => {
    claimEvents.mockResolvedValue([new Outbox({})]);
    const subscriber = new OutboxSubscriber();
    subscriber.start();
    expect(claimEvents).toHaveBeenCalled();
    expect(subscriber.running).toBeTruthy();
  });

  it("should stop polling after stop()", () => {
    claimEvents.mockResolvedValue([new Outbox({})]);
    const subscriber = new OutboxSubscriber(10);
    subscriber.start();
    expect(claimEvents).toHaveBeenCalledTimes(1);
    subscriber.stop();
    expect(subscriber.running).toBeFalsy();
  });

  it("should mark events as unsent", async () => {
    publish.mockRejectedValue(1);
    const mockEvent = {
      target: "arn:some:value",
      event: {},
      markAsFailed: vi.fn(),
    };
    const outbox = new OutboxSubscriber();
    await outbox.sendEvent(mockEvent);
    expect(mockEvent.markAsFailed).toHaveBeenCalled();
  });

  it("should mark events as sent", async () => {
    publish.mockResolvedValue(1);

    const mockEvent = {
      target: "arn:some:value",
      event: {},
      markAsComplete: vi.fn(),
    };
    const outbox = new OutboxSubscriber();
    await outbox.sendEvent(mockEvent);
    expect(mockEvent.markAsComplete).toHaveBeenCalled();
  });

  it("should mark event as complete", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});
    AsyncLocalStorage.prototype.getStore = vi.fn().mockReturnValue("1234");

    const mockEvent = {
      target: "arn:some:value",
      event: {},
      markAsComplete: vi.fn(),
    };
    const outbox = new OutboxSubscriber();
    await outbox.markEventComplete(mockEvent);
    expect(mockEvent.markAsComplete).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(mockEvent, "1234");
  });

  it("should mark an event as unsent", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});
    AsyncLocalStorage.prototype.getStore = vi.fn().mockReturnValue("1234");

    const mockEvent = {
      target: "arn:some:value",
      event: {},
      markAsFailed: vi.fn(),
    };
    const outbox = new OutboxSubscriber();
    await outbox.markEventUnsent(mockEvent);
    expect(mockEvent.markAsFailed).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(mockEvent, "1234");
  });

  it("should processFailedEvents", async () => {
    claimEvents.mockResolvedValue([]);
    updateFailedEvents.mockResolvedValue({ modifiedCount: 1 });
    const subscriber = new OutboxSubscriber();
    await subscriber.processFailedEvents();
    expect(updateFailedEvents).toHaveBeenCalled();
  });

  it("should processResubmittedEvents", async () => {
    claimEvents.mockResolvedValue([]);
    updateResubmittedEvents.mockResolvedValue({ modifiedCount: 1 });
    const subscriber = new OutboxSubscriber();
    await subscriber.processResubmittedEvents();
    expect(updateResubmittedEvents).toHaveBeenCalled();
  });

  it("should processDeadEvents", async () => {
    claimEvents.mockResolvedValue([]);
    updateDeadEvents.mockResolvedValue({ modifiedCount: 1 });
    const subscriber = new OutboxSubscriber();
    await subscriber.processDeadEvents();
    expect(updateDeadEvents).toHaveBeenCalled();
  });
});
