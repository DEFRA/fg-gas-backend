import { describe, expect, it, vi } from "vitest";
import { withTraceParent } from "../../common/trace-parent.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { ingestAgreementEvent } from "./agreement-event-ingestion.use-case.js";
import {
  createExternalStateChangeCommand,
  processInboxEvent,
} from "./process-inbox-event.use-case.js";

vi.mock("../../common/trace-parent.js");
vi.mock("../services/apply-event-status-change.service.js");
vi.mock("./agreement-event-ingestion.use-case.js");

describe("process inbox event", () => {
  it("creates an external state-change command from Caseworking event data", () => {
    const eventData = {
      caseRef: "case-ref-123",
      currentStatus: "APPROVED",
      workflowCode: "test-code",
    };

    expect(
      createExternalStateChangeCommand({
        event: {
          data: eventData,
        },
        messageId: "message-123",
        source: "CW",
      }),
    ).toEqual({
      sourceSystem: "CW",
      clientRef: "case-ref-123",
      code: "test-code",
      externalRequestedState: "APPROVED",
      eventData,
    });
  });

  it("throws when the inbox event cannot become a state-change command", () => {
    expect(() =>
      createExternalStateChangeCommand({
        event: {
          data: {
            foo: "bar",
          },
        },
        messageId: "message-123",
        source: "CW",
      }),
    ).toThrow("Unable to handle inbox message message-123");
  });

  it("delegates Agreement Service events to Agreement event ingestion", async () => {
    const inboxEvent = {
      event: {
        data: {
          clientRef: "client-ref-123",
          code: "test-code",
          status: "cancelled",
        },
      },
      messageId: "message-123",
      source: "AS",
      traceparent: "1234-abcd",
    };

    ingestAgreementEvent.mockResolvedValue(true);

    await processInboxEvent(inboxEvent);

    expect(ingestAgreementEvent).toHaveBeenCalledWith(inboxEvent);
    expect(applyExternalStateChange).not.toHaveBeenCalled();
  });

  it("applies Caseworking state changes with the inbox trace parent", async () => {
    const eventData = {
      caseRef: "case-ref-123",
      currentStatus: "APPROVED",
      workflowCode: "test-code",
    };

    applyExternalStateChange.mockResolvedValue(true);
    withTraceParent.mockImplementation((_, fn) => fn());

    await processInboxEvent({
      event: {
        data: eventData,
      },
      messageId: "message-123",
      source: "CW",
      traceparent: "1234-abcd",
    });

    expect(withTraceParent).toHaveBeenCalledWith(
      "1234-abcd",
      expect.any(Function),
    );
    expect(applyExternalStateChange).toHaveBeenCalledWith({
      sourceSystem: "CW",
      clientRef: "case-ref-123",
      code: "test-code",
      externalRequestedState: "APPROVED",
      eventData,
    });
  });
});
