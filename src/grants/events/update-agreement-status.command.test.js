import { describe, expect, it } from "vitest";
import { AgreementServiceStatus } from "../models/agreement.js";
import { UpdateAgreementStatusCommand } from "./update-agreement-status.command.js";
import { withTraceParent } from "../../common/trace-parent.js";

describe("UpdateAgreementStatusCommand", () => {
  it("should create event", () => {
    const command = {
      clientRef: "application-123",
      code: "grant-code",
      status: AgreementServiceStatus.Withdrawn 
    }
    const event = withTraceParent("trace-id-1", () => new UpdateAgreementStatusCommand(command));

    expect(event).toEqual({
      id: expect.any(String),
      type: "cloud.defra.local.fg-gas-backend.agreement.status.update",
      source: "fg-gas-backend",
      specversion: "1.0",
      traceparent: "trace-id-1",
      time: expect.any(String),
      datacontenttype: "application/json",
      data: {
        clientRef: "application-123",
        code: "grant-code",
        status: "withdrawn"
      },
    });
  });
});
