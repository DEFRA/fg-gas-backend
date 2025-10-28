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
import { withTraceParent } from "../../common/trace-parent.js";
import { Inbox } from "../models/inbox.js";
import { claimEvents } from "../repositories/inbox.repository.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";
import { InboxSubscriber } from "./inbox.subscriber.js";

vi.mock("../../common/trace-parent.js");
vi.mock("../use-cases/approve-application.use-case.js");
vi.mock("../repositories/inbox.repository.js");
vi.mock("../services/apply-event-status-change.service.js");

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
    claimEvents.mockResolvedValue([new Inbox({})]);
    const subscriber = new InboxSubscriber();
    subscriber.start();
    expect(claimEvents).toHaveBeenCalled();
    expect(subscriber.running).toBeTruthy();
  });

  it("should stop polling after stop()", async () => {
    claimEvents.mockResolvedValue([new Inbox({})]);
    const subscriber = new InboxSubscriber();
    subscriber.start();
    expect(claimEvents).toHaveBeenCalledTimes(1);
    subscriber.stop();
    vi.advanceTimersByTime(500);
    expect(subscriber.running).toBeFalsy();
    expect(claimEvents).toHaveBeenCalledTimes(1);
  });

  describe("processEvents", () => {
    it("should use use-cases if not updating status", async () => {
      const mockEventData = {
        foo: "barr",
      };
      approveApplicationUseCase.mockResolvedValue(true);

      withTraceParent.mockImplementation((_, fn) => fn());
      const mockEvent = {
        type: "io.onsite.agreement.offer.offered",
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

    it("should mark events as failed", async () => {
      applyExternalStateChange.mockRejectedValueOnce(false);
      const mockEventData = {
        currentStatus: "APPROVE",
        foo: "barr",
      };

      withTraceParent.mockImplementation((_, fn) => fn());
      const mockEvent = {
        type: "io.onsite.agreement.offer.offered",
        traceparent: "1234-abcd",
        event: {
          data: mockEventData,
        },
        markAsFailed: vi.fn(),
      };
      const inbox = new InboxSubscriber();
      await inbox.processEvents([mockEvent]);
      expect(withTraceParent).toHaveBeenCalled();
      expect(mockEvent.markAsFailed).toHaveBeenCalled();
    });

    it("should mark events as complete", async () => {
      const mockEventData = {
        foo: "barr",
      };
      approveApplicationUseCase.mockResolvedValue("complete");

      withTraceParent.mockImplementationOnce((_, fn) => fn());
      const mockEvent = {
        type: "io.onsite.agreement.offer.offered",
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
