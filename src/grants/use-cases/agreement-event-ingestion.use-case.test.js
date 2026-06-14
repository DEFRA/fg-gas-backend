import { describe, expect, it, vi } from "vitest";
import { withTraceParent } from "../../common/trace-parent.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import {
  createAgreementExternalStateChangeCommand,
  ingestAgreementEvent,
} from "./agreement-event-ingestion.use-case.js";

vi.mock("../../common/trace-parent.js");
vi.mock("../services/apply-event-status-change.service.js");

describe("Agreement event ingestion", () => {
  it("creates an external state-change command from Agreement event data", () => {
    const eventData = {
      agreementNumber: "AG123",
      clientRef: "client-ref-123",
      code: "test-code",
      status: "accepted",
    };

    expect(
      createAgreementExternalStateChangeCommand({
        event: {
          data: eventData,
        },
        messageId: "message-123",
        source: "AS",
      }),
    ).toEqual({
      sourceSystem: "AS",
      clientRef: "client-ref-123",
      code: "test-code",
      externalRequestedState: "accepted",
      eventData,
    });
  });

  it("supports legacy Agreement state field names while events migrate", () => {
    const eventData = {
      caseRef: "case-ref-123",
      currentStatus: "offered",
      workflowCode: "test-code",
    };

    expect(
      createAgreementExternalStateChangeCommand({
        event: {
          data: eventData,
        },
        messageId: "message-123",
        source: "AS",
      }),
    ).toEqual({
      sourceSystem: "AS",
      clientRef: "case-ref-123",
      code: "test-code",
      externalRequestedState: "offered",
      eventData,
    });
  });

  it("throws when the Agreement event cannot become a state-change command", () => {
    expect(() =>
      createAgreementExternalStateChangeCommand({
        event: {
          data: {
            foo: "bar",
          },
        },
        messageId: "message-123",
        source: "AS",
      }),
    ).toThrow("Unable to handle inbox message message-123");
  });

  it("applies the state change with the Agreement event trace parent", async () => {
    const eventData = {
      clientRef: "client-ref-123",
      code: "test-code",
      status: "cancelled",
    };

    applyExternalStateChange.mockResolvedValue(true);
    withTraceParent.mockImplementation((_, fn) => fn());

    await ingestAgreementEvent({
      event: {
        data: eventData,
      },
      messageId: "message-123",
      source: "AS",
      traceparent: "1234-abcd",
    });

    expect(withTraceParent).toHaveBeenCalledWith(
      "1234-abcd",
      expect.any(Function),
    );
    expect(applyExternalStateChange).toHaveBeenCalledWith({
      sourceSystem: "AS",
      clientRef: "client-ref-123",
      code: "test-code",
      externalRequestedState: "cancelled",
      eventData,
    });
  });
});
