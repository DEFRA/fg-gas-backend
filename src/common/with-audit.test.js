import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditStatus } from "./audit-constants.js";
import { buildAuditEvent, withAudit } from "./with-audit.js";
import { writeAuditEvent } from "./write-audit-event.js";

vi.mock("./write-audit-event.js", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("buildAuditEvent", () => {
  const baseArgs = {
    entity: "APPLICATION",
    action: "SUBMIT",
    entityid: "app-123",
  };

  it("spreads security into the result when security is provided", () => {
    const security = { userId: "user-1" };
    const result = buildAuditEvent({ ...baseArgs, security });
    expect(result).toHaveProperty("security", security);
  });

  it("omits security from the result when security is not provided", () => {
    const result = buildAuditEvent({ ...baseArgs });
    expect(result).not.toHaveProperty("security");
  });

  it("falls back to entityid for messageGroupId when messageGroupId is not provided", () => {
    const result = buildAuditEvent({ ...baseArgs });
    expect(result.messageGroupId).toBe("app-123");
  });

  it("uses messageGroupId when provided", () => {
    const result = buildAuditEvent({ ...baseArgs, messageGroupId: "msg-456" });
    expect(result.messageGroupId).toBe("msg-456");
  });

  it("defaults details to an empty object when not provided", () => {
    const result = buildAuditEvent({ ...baseArgs });
    expect(result.details).toEqual({});
  });

  it("strips sbi, frn, crn from details into accounts", () => {
    const details = { sbi: "sbi-1", frn: "frn-1", crn: "crn-1", code: "x" };
    const result = buildAuditEvent({ ...baseArgs, details });
    expect(result.accounts).toEqual({
      sbi: "sbi-1",
      frn: "frn-1",
      crn: "crn-1",
    });
    expect(result.details).toEqual({ code: "x" });
  });
});

describe("withAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeAuditEvent.mockResolvedValue(undefined);
  });

  describe("success path", () => {
    it("returns the result of the wrapped function", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi.fn().mockReturnValue({
        accounts: { sbi: "1" },
        entities: [],
        details: {},
        messageGroupId: "msg-1",
        security: undefined,
      });

      const result = await withAudit(fn, dataBuilder)("arg0");

      expect(result).toEqual({ id: "123" });
    });

    it("calls the wrapped function with the provided args", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0", "session-id");

      expect(fn).toHaveBeenCalledWith("arg0", "session-id");
    });

    it("calls dataBuilder with args array and result", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0", "session-id");

      expect(dataBuilder).toHaveBeenCalledWith(["arg0", "session-id"], {
        id: "123",
      });
    });

    it("writes the audit event with entities, details, messageGroupId and security from dataBuilder", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi.fn().mockReturnValue({
        entities: [{ type: "APPLICATION", id: "app-1" }],
        details: { code: "woodlands" },
        messageGroupId: "msg-1",
        security: { userId: "user-1" },
      });

      await withAudit(fn, dataBuilder)("arg0", "my-session");

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entities: [{ type: "APPLICATION", id: "app-1" }],
          details: { code: "woodlands" },
          messageGroupId: "msg-1",
          security: { userId: "user-1" },
        }),
        "my-session",
      );
    });

    it("passes args[1] as the session to writeAuditEvent", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0", "my-session");

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "my-session",
      );
    });

    it("writes SUCCESS status on success", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0", "my-session");

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: auditStatus.SUCCESS }),
        "my-session",
      );
    });

    it("skips writing the audit event when dataBuilder returns null", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi.fn().mockReturnValue(null);

      const result = await withAudit(fn, dataBuilder)("arg0", "my-session");

      expect(result).toEqual({ id: "123" });
      expect(writeAuditEvent).not.toHaveBeenCalled();
    });

    it("does not propagate writeAuditEvent errors", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });
      writeAuditEvent.mockRejectedValue(new Error("SNS unavailable"));

      await expect(withAudit(fn, dataBuilder)("arg0")).resolves.toEqual({
        id: "123",
      });
    });

    it("does not propagate dataBuilder errors", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi.fn().mockImplementation(() => {
        throw new Error("builder failed");
      });

      await expect(withAudit(fn, dataBuilder)("arg0")).resolves.toEqual({
        id: "123",
      });
    });
  });

  describe("failure path", () => {
    it("rethrows when the wrapped function throws", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("use case failed"));
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await expect(withAudit(fn, dataBuilder)("arg0")).rejects.toThrow(
        "use case failed",
      );
    });

    it("writes a FAILURE audit event when the wrapped function throws", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("use case failed"));
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0").catch(() => {});

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: auditStatus.FAILURE }),
        null,
      );
    });

    it("passes null as the session when the wrapped function throws", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("use case failed"));
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0", "my-session").catch(() => {});

      expect(writeAuditEvent).toHaveBeenCalledWith(expect.anything(), null);
    });

    it("calls dataBuilder with undefined result when the wrapped function throws", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("use case failed"));
      const dataBuilder = vi
        .fn()
        .mockReturnValue({ entities: [], details: {} });

      await withAudit(fn, dataBuilder)("arg0").catch(() => {});

      expect(dataBuilder).toHaveBeenCalledWith(["arg0"], undefined);
    });

    it("rethrows the original error even when dataBuilder throws", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("use case failed"));
      const dataBuilder = vi.fn().mockImplementation(() => {
        throw new Error("builder failed");
      });

      await expect(withAudit(fn, dataBuilder)("arg0")).rejects.toThrow(
        "use case failed",
      );
    });
  });
});
