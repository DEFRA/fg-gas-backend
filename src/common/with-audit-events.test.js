import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { withAuditEvents } from "./with-audit-events.js";
import { writeAuditEvent } from "./write-audit-event.js";

vi.mock("./logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("./write-audit-event.js", () => ({
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const validAuditEvent = () => ({
  entities: [{ entity: "Thing", action: "DO_THING", entityid: "id-1" }],
  details: {},
  messageGroupId: "thing-id-1",
});

describe("withAuditEvents", () => {
  beforeEach(() => {
    writeAuditEvent.mockResolvedValue(undefined);
  });

  it("returns the use-case result on success", async () => {
    const useCase = vi.fn().mockResolvedValue("ok");
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    const result = await wrapped("arg1");

    expect(result).toBe("ok");
  });

  it("calls writeAuditEvent with SUCCESS status on success", async () => {
    const useCase = vi.fn().mockResolvedValue({ id: 42 });
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await wrapped("arg1");

    expect(writeAuditEvent).toHaveBeenCalledOnce();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      undefined,
    );
  });

  it("re-throws and calls writeAuditEvent with FAILURE status when use-case throws", async () => {
    const useCase = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await expect(wrapped()).rejects.toThrow("boom");

    await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledOnce());
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
      undefined,
    );
  });

  it("passes entities, details, messageGroupId and security to writeAuditEvent", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const auditSpec = {
      entities: [{ entity: "App", action: "DO", entityid: "abc" }],
      details: { code: "X" },
      messageGroupId: "abc-X",
      security: { level: "high" },
    };
    const wrapped = withAuditEvents(useCase, () => auditSpec);

    await wrapped();

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: auditSpec.entities,
        details: auditSpec.details,
        messageGroupId: auditSpec.messageGroupId,
        security: auditSpec.security,
      }),
      undefined,
    );
  });

  it("warns when use-case succeeds but no session was returned from buildAuditEvent", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => validAuditEvent()); // no session

    await wrapped();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("outside transaction"),
    );
  });

  it("does not warn when a session is provided on success", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => ({
      ...validAuditEvent(),
      session: {},
    }));

    await wrapped();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not surface writeAuditEvent errors to the caller", async () => {
    writeAuditEvent.mockRejectedValue(new Error("DB down"));
    const useCase = vi.fn().mockResolvedValue("result");
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await expect(wrapped()).resolves.toBe("result");

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to write audit event",
    );
  });
});
