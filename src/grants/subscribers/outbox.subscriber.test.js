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
  freeFifoLock,
  getFifoLocks,
  setFifoLock,
} from "../repositories/fifo-lock.repository.js";
import {
  claimEvents,
  findNextMessage,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "../repositories/outbox.repository.js";
import { OutboxSubscriber } from "./outbox.subscriber.js";

vi.mock("../../common/sns-client.js");

vi.mock("../repositories/fifo-lock.repository.js");
vi.mock("../repositories/outbox.repository.js");

const createOutbox = (doc) =>
  new Outbox({
    event: {
      time: new Date().toISOString(),
    },
    ...doc,
  });

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
    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    claimEvents.mockResolvedValue([Outbox.createMock()]);
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue();
    freeFifoLock.mockResolvedValue();
    vi.spyOn(OutboxSubscriber.prototype, "processEvents").mockResolvedValue();
    const subscriber = new OutboxSubscriber();
    subscriber.start();
    await vi.waitFor(() => {
      expect(claimEvents).toHaveBeenCalled();
    });
    expect(claimEvents).toHaveBeenCalled();
    expect(setFifoLock).toHaveBeenCalledWith(OutboxSubscriber.ACTOR, "ref_1");
    expect(freeFifoLock).toHaveBeenCalledWith(OutboxSubscriber.ACTOR, "ref_1");
    expect(subscriber.running).toBeTruthy();
  });

  it("should continue polling and process events after an error", async () => {
    const error = new Error("Temporary poll failure");
    vi.spyOn(logger, "error");
    vi.spyOn(logger, "info");

    const mockEvent = new Outbox({
      target: "arn:aws:sns:eu-west-2:000000000000:test-topic",
      event: { data: { foo: "bar" } },
    });
    mockEvent.markAsComplete = vi.fn();

    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    claimEvents.mockResolvedValue([Outbox.createMock()]);
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue();
    freeFifoLock.mockResolvedValue();

    claimEvents
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([mockEvent])
      .mockResolvedValue([]);

    publish.mockResolvedValue(1);

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(error, "Error polling outbox");
    });

    await vi.advanceTimersByTimeAsync(subscriber.interval);

    await vi.waitFor(() => {
      expect(publish).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(subscriber.interval);

    await vi.waitFor(() => {
      expect(claimEvents).toHaveBeenCalledTimes(3);
    });

    expect(subscriber.running).toBeTruthy();

    subscriber.stop();
  });

  it("should stop polling after stop()", async () => {
    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    claimEvents.mockResolvedValue([Outbox.createMock()]);
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue();
    freeFifoLock.mockResolvedValue();
    claimEvents.mockResolvedValue([Outbox.createMock()]);
    const subscriber = new OutboxSubscriber(10);
    subscriber.start();
    await vi.waitFor(() => {
      expect(claimEvents).toHaveBeenCalled();
    });
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

  it("should handle messageIds for legacy event types (agreements)", async () => {
    publish.mockResolvedValue(1);
    const mockEvent = {
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status",
      event: {
        clientRef: "client-ref",
        grantCode: "grant-code",
      },
      markAsComplete: vi.fn(),
    };

    const outbox = new OutboxSubscriber();
    await outbox.sendEvent(mockEvent);
    expect(publish.mock.calls[0][2]).toBe("client-ref-grant-code");
  });

  it("should handle messageIds for legacy event types (case working)", async () => {
    publish.mockResolvedValue(1);
    const mockEvent = {
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status",
      event: {
        caseRef: "case-ref",
        workflowCode: "workflow-code",
      },
      markAsComplete: vi.fn(),
    };

    const outbox = new OutboxSubscriber();
    await outbox.sendEvent(mockEvent);
    expect(publish.mock.calls[0][2]).toBe("case-ref-workflow-code");
  });

  it("should handle legacy event types", async () => {
    publish.mockResolvedValue(1);
    const mockEvent = {
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status",
      event: {},
      markAsComplete: vi.fn(),
    };

    const outbox = new OutboxSubscriber();
    await outbox.sendEvent(mockEvent);
    expect(publish.mock.calls[0][0]).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo.fifo",
    );
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
