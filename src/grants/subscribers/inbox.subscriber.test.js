import { setTimeout } from "node:timers/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { withTraceParent } from "../../common/trace-parent.js";
import { Inbox } from "../models/inbox.js";
import { claimEvents } from "../repositories/inbox.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { handleAgreementStatusChangeUseCase } from "../use-cases/handle-agreement-status-change.use-case.js";
import { InboxSubscriber } from "./inbox.subscriber.js";

vi.mock("../../common/trace-parent.js");
vi.mock("../use-cases/approve-application.use-case.js");
vi.mock("../repositories/inbox.repository.js");
vi.mock("../services/apply-event-status-change.service.js");
vi.mock("../use-cases/handle-agreement-status-change.use-case.js");

const createInbox = () =>
  new Inbox({
    event: {
      time: new Date().toISOString(),
    },
  });

describe("inbox.subscriber", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  afterAll(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("should create an inbox subscriber", () => {
    const subs = new InboxSubscriber();
    expect(subs).toBeInstanceOf(InboxSubscriber);
    expect(subs.interval).toBe(config.inbox.inboxPollMs);
    expect(subs.running).toBeFalsy();
  });

  it("should poll on start()", async () => {
    claimEvents.mockResolvedValue([createInbox()]);
    const subscriber = new InboxSubscriber();
    subscriber.start();
    expect(claimEvents).toHaveBeenCalled();
    expect(subscriber.running).toBeTruthy();
  });

  it("should continue polling and process events after an error", async () => {
    const error = new Error("Temporary poll failure");
    vi.spyOn(logger, "error");
    vi.spyOn(logger, "info");

    const mockEvent = new Inbox({
      type: "io.onsite.agreement.status.foo",
      traceparent: "test-trace",
      event: { data: { foo: "bar" } },
    });

    claimEvents
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce([mockEvent])
      .mockResolvedValue([]);

    handleAgreementStatusChangeUseCase.mockResolvedValue(true);
    withTraceParent.mockImplementation((_, fn) => fn());

    const subscriber = new InboxSubscriber();
    subscriber.start();

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(error, "Error polling inbox");
    });

    await vi.advanceTimersByTimeAsync(subscriber.interval);

    await vi.waitFor(() => {
      expect(handleAgreementStatusChangeUseCase).toHaveBeenCalled();
    });

    await vi.advanceTimersByTimeAsync(subscriber.interval);

    await vi.waitFor(() => {
      expect(claimEvents).toHaveBeenCalledTimes(3);
    });

    expect(subscriber.running).toBeTruthy();

    subscriber.stop();
  });

  it("should stop polling after stop()", async () => {
    claimEvents.mockResolvedValue([createInbox()]);
    const subscriber = new InboxSubscriber();
    subscriber.start();
    expect(claimEvents).toHaveBeenCalledTimes(1);
    subscriber.stop();
    vi.advanceTimersByTime(500);
    expect(subscriber.running).toBeFalsy();
    expect(claimEvents).toHaveBeenCalledTimes(1);
  });

  describe("processEvents", () => {
    it("should process events in correct order", async () => {
      const events = [
        Inbox.createMock({
          _id: "1",
          event: { time: new Date(Date.now()).toISOString() },
        }),
        Inbox.createMock({
          _id: "2",
          event: { time: new Date(Date.now()).toISOString() },
        }),
      ];

      claimEvents.mockResolvedValue(events);
      const subscriber = new InboxSubscriber();
      const spy1 = vi
        .spyOn(subscriber, "handleEvent")
        .mockImplementationOnce(async () => {
          return setTimeout(500);
        })
        .mockImplementationOnce(async () => setTimeout(500));
      await subscriber.processEvents(events);
      expect(spy1).toHaveBeenCalledTimes(2);

      expect(subscriber.handleEvent.mock.calls[0][0]).toEqual(events[0]);
      expect(subscriber.handleEvent.mock.calls[1][0]).toEqual(events[1]);
    });

    it("should use use-cases if not updating status", async () => {
      const mockEventData = {
        foo: "barr",
      };
      handleAgreementStatusChangeUseCase.mockResolvedValue(true);

      withTraceParent.mockImplementation((_, fn) => fn());
      const mockEvent = {
        type: "io.onsite.agreement.status.foo",
        traceparent: "1234-abcd",
        event: {
          data: mockEventData,
        },
        markAsComplete: vi.fn(),
      };
      const inbox = new InboxSubscriber();
      await inbox.processEvents([mockEvent]);
      expect(withTraceParent).toHaveBeenCalled();
      expect(withTraceParent.mock.calls[0][0]).toBe("1234-abcd");
      expect(mockEvent.markAsComplete).toHaveBeenCalled();
    });

    it("throws if unable to handle inbox message", async () => {
      const mockEventData = {
        foo: "barr",
      };

      const mockMessage = {
        messageId: "message-1234",
        type: "u.nknown.event.id",
        traceparent: "1234-abcd",
        event: {
          data: mockEventData,
        },
        markAsFailed: vi.fn(),
      };
      const inbox = new InboxSubscriber();
      inbox.handleEvent(mockMessage);
      expect(mockMessage.markAsFailed).toHaveBeenCalled();
    });

    it("should mark events as failed", async () => {
      applyExternalStateChange.mockRejectedValueOnce(false);
      withTraceParent.mockImplementation((_, fn) => fn());

      const mockEventData = {
        currentStatus: "APPROVE",
        foo: "barr",
      };

      const mockEvent = {
        type: "u.nknown.event.id",
        source: "CW",
        traceparent: "1234-abcd",
        event: {
          data: mockEventData,
        },
        markAsFailed: vi.fn(),
      };
      const inbox = new InboxSubscriber();
      await inbox.processEvents([mockEvent]);
      expect(applyExternalStateChange).toHaveBeenCalled();
      expect(withTraceParent).toHaveBeenCalled();
      expect(mockEvent.markAsFailed).toHaveBeenCalled();
    });

    it("should mark events as complete", async () => {
      const mockEventData = {
        foo: "barr",
      };
      handleAgreementStatusChangeUseCase.mockResolvedValue("complete");

      withTraceParent.mockImplementationOnce((_, fn) => fn());
      const mockEvent = {
        type: "io.onsite.agreement.status.foo",
        traceparent: "1234-abcd",
        event: {
          data: mockEventData,
        },
        markAsComplete: vi.fn(),
      };
      const inbox = new InboxSubscriber();
      await inbox.processEvents([mockEvent]);
      expect(withTraceParent).toHaveBeenCalled();
      expect(mockEvent.markAsComplete).toHaveBeenCalled();
    });
  });
});
