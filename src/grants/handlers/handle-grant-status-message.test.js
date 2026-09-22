import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTraceParent } from "../../common/trace-parent.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { handleGrantStatusMessage } from "./handle-grant-status-message.js";

vi.mock("../../common/trace-parent.js");
vi.mock("../services/apply-event-status-change.service.js");

describe("handleGrantStatusMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTraceParent.mockImplementation((_, handler) => handler());
  });

  it("maps Agreement Service status messages to a Grants state change", async () => {
    const data = {
      clientRef: "client-ref-123",
      code: "test-code",
      agreementNumber: "AG123",
      status: "cancelled",
    };

    await handleGrantStatusMessage({
      messageId: "message-1",
      source: "AS",
      traceparent: "1234-abcd",
      event: { data },
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
      eventData: data,
    });
  });

  it("maps Case Working field names to the same Grants state change", async () => {
    const data = {
      caseRef: "case-ref-123",
      workflowCode: "test-code",
      currentStatus: "APPROVE",
    };

    await handleGrantStatusMessage({
      messageId: "message-2",
      source: "CW",
      traceparent: "trace-2",
      event: { data },
    });

    expect(applyExternalStateChange).toHaveBeenCalledWith({
      sourceSystem: "CW",
      clientRef: "case-ref-123",
      code: "test-code",
      externalRequestedState: "APPROVE",
      eventData: data,
    });
  });

  it("rejects a message without a status", async () => {
    await expect(
      handleGrantStatusMessage({
        messageId: "message-3",
        source: "CW",
        event: { data: {} },
      }),
    ).rejects.toThrow("Unable to handle inbox message message-3");
  });
});
