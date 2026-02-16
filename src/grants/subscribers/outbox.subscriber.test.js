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
  cleanupStaleLocks,
  freeFifoLock,
  getFifoLocks,
  setFifoLock,
} from "../repositories/fifo-lock.repository.js";
import {
  claimEvents,
  deadLetterEvent,
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
    target: "arn:aws:sns:eu-west-2:000000000000:test-topic",
    event: {
      time: new Date().toISOString(),
    },
    segregationRef: "default-ref",
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
    vi.restoreAllMocks();
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
    setFifoLock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
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
      segregationRef: "ref_1",
    });
    mockEvent.markAsComplete = vi.fn();

    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    claimEvents.mockResolvedValue([Outbox.createMock()]);
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
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
    setFifoLock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
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

  it("should release lock even when claimEvents throws an error", async () => {
    const error = new Error("claimEvents failed");
    vi.spyOn(logger, "error");

    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    freeFifoLock.mockResolvedValue();
    claimEvents.mockRejectedValueOnce(error).mockResolvedValue([]);

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(error, "Error polling outbox");
    });

    expect(setFifoLock).toHaveBeenCalledWith(OutboxSubscriber.ACTOR, "ref_1");
    expect(freeFifoLock).toHaveBeenCalledWith(OutboxSubscriber.ACTOR, "ref_1");

    subscriber.stop();
  });

  it("should release lock even when processEvents throws an error", async () => {
    const error = new Error("processEvents failed");
    vi.spyOn(logger, "error");

    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    freeFifoLock.mockResolvedValue();
    claimEvents
      .mockResolvedValueOnce([Outbox.createMock()])
      .mockResolvedValue([]);
    vi.spyOn(OutboxSubscriber.prototype, "processEvents").mockRejectedValueOnce(
      error,
    );

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(error, "Error polling outbox");
    });

    expect(setFifoLock).toHaveBeenCalledWith(OutboxSubscriber.ACTOR, "ref_1");
    expect(freeFifoLock).toHaveBeenCalledWith(OutboxSubscriber.ACTOR, "ref_1");

    subscriber.stop();
  });

  it("should call cleanupStaleLocks during poll", async () => {
    findNextMessage.mockResolvedValue(null);
    getFifoLocks.mockResolvedValue([]);
    cleanupStaleLocks.mockResolvedValue({ modifiedCount: 0 });

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(cleanupStaleLocks).toHaveBeenCalled();
    });

    subscriber.stop();
  });

  it("should DLQ any records that have no segregationRef and retry getNextAvailable", async () => {
    vi.spyOn(logger, "info");
    findNextMessage
      .mockResolvedValueOnce({ segregationRef: null })
      .mockResolvedValueOnce({ segregationRef: "segregation_ref_1" });
    getFifoLocks.mockResolvedValue(["segregation_ref_2"]);
    setFifoLock.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 1,
      upsertedCount: 1,
    });
    freeFifoLock.mockResolvedValue();
    cleanupStaleLocks.mockResolvedValue({ modifiedCount: 1 });
    deadLetterEvent.mockResolvedValue();

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(claimEvents).toHaveBeenCalledWith(
        expect.any(String),
        "segregation_ref_1",
      );
    });

    expect(claimEvents).toHaveBeenCalledTimes(1);
    expect(findNextMessage).toHaveBeenCalledTimes(2);
    expect(deadLetterEvent).toHaveBeenCalledTimes(1);

    subscriber.stop();
  });

  it("should not process events when lock acquisition fails", async () => {
    vi.spyOn(logger, "info");
    findNextMessage.mockResolvedValue(
      createOutbox({ segregationRef: "ref_1" }),
    );
    getFifoLocks.mockResolvedValue([]);
    setFifoLock.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
    });
    freeFifoLock.mockResolvedValue();
    cleanupStaleLocks.mockResolvedValue({ modifiedCount: 0 });

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(
        "Outbox Unable to process lock for segregationref ref_1",
      );
    });

    expect(claimEvents).not.toHaveBeenCalled();

    subscriber.stop();
  });

  it("should not append _fifo.fifo when topic already ends with _fifo.fifo", async () => {
    publish.mockResolvedValue(1);
    const mockEvent = {
      target:
        "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement_fifo.fifo",
      event: {},
      markAsComplete: vi.fn(),
    };

    const outbox = new OutboxSubscriber();
    await outbox.sendEvent(mockEvent);
    expect(publish.mock.calls[0][0]).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement_fifo.fifo",
    );
  });

  it("should processExpiredEvents", async () => {
    const { updateExpiredEvents } =
      await import("../repositories/outbox.repository.js");
    updateExpiredEvents.mockResolvedValue({ modifiedCount: 2 });
    const subscriber = new OutboxSubscriber();
    await subscriber.processExpiredEvents();
    expect(updateExpiredEvents).toHaveBeenCalled();
  });

  it("should log when stale locks are cleaned up", async () => {
    vi.spyOn(logger, "info");
    findNextMessage.mockResolvedValue(null);
    getFifoLocks.mockResolvedValue([]);
    cleanupStaleLocks.mockResolvedValue({ modifiedCount: 3 });

    const subscriber = new OutboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith("Cleaned up 3 stale fifo locks");
    });

    subscriber.stop();
  });
});
