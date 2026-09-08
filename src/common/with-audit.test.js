import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditStatus } from "./audit-constants.js";
import { buildAuditEvent, withAudit } from "./with-audit.js";
import { writeAuditEvent } from "./write-audit-event.js";

vi.mock("./write-audit-event.js", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("./logger.js");

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

  it("uses the provided segregationRef", () => {
    const result = buildAuditEvent({
      ...baseArgs,
      segregationRef: "submission-client-1",
    });
    expect(result.segregationRef).toBe("submission-client-1");
  });

  it("falls back to entityid when no segregationRef is provided", () => {
    const result = buildAuditEvent({ ...baseArgs });
    expect(result.segregationRef).toBe("app-123");
  });

  // segregationRef partitions outbox work only. messageGroupId is an SNS FIFO
  // transport parameter and must never reach the published message body.
  it("never sets a messageGroupId, even when one is passed", () => {
    const result = buildAuditEvent({ ...baseArgs, messageGroupId: "msg-456" });
    expect(result).not.toHaveProperty("messageGroupId");
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

    it("writes the audit event with entities, details and security from dataBuilder", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi.fn().mockReturnValue({
        entities: [
          { entity: "APPLICATION", action: "SUBMIT", entityid: "app-1" },
        ],
        details: { code: "woodlands" },
        security: { userId: "user-1" },
      });

      await withAudit(fn, dataBuilder)("arg0", "my-session");

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entities: [
            { entity: "APPLICATION", action: "SUBMIT", entityid: "app-1" },
          ],
          details: { code: "woodlands" },
          security: { userId: "user-1" },
        }),
        "my-session",
      );
    });

    it("forwards the dataBuilder segregationRef to writeAuditEvent", async () => {
      const fn = vi.fn().mockResolvedValue({ id: "123" });
      const dataBuilder = vi.fn().mockReturnValue({
        entities: [],
        details: {},
        segregationRef: "submission-client-1",
      });

      await withAudit(fn, dataBuilder)("arg0", "my-session");

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ segregationRef: "submission-client-1" }),
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

  // Inside a caller's transaction the audit insert is part of the same commit
  // as the action, so a swallowed failure would let the action land unaudited.
  describe("audit failure inside a transaction", () => {
    const dataBuilder = () => ({ entities: [], details: {} });

    it("rethrows the audit failure when a session is active", async () => {
      const fn = vi.fn().mockResolvedValue({ ok: true });
      writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

      await expect(
        withAudit(fn, dataBuilder)("arg0", "my-session"),
      ).rejects.toThrow("outbox insert failed");
      // The action ran; it is the transaction's abort that undoes it.
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("swallows the audit failure when there is no session", async () => {
      const fn = vi.fn().mockResolvedValue({ ok: true });
      writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

      await expect(withAudit(fn, dataBuilder)("arg0")).resolves.toEqual({
        ok: true,
      });
    });

    // NOT closed, and deliberately: a `dataBuilder` answering null is the
    // caller saying there is nothing to audit - a claims replay that created
    // nothing, an entitlement that was not written - and both of those callers
    // are transactional. Throwing here would abort a transaction that did
    // exactly what it meant to. It is a decision not to audit, unlike a
    // validation failure, which is an inability to.
    it("skips the audit without failing when the builder answers null", async () => {
      const fn = vi.fn().mockResolvedValue({ ok: true });
      const noAudit = () => null;

      await expect(
        withAudit(fn, noAudit)("arg0", "my-session"),
      ).resolves.toEqual({ ok: true });
      expect(writeAuditEvent).not.toHaveBeenCalled();
    });

    // The failure path nulls the session precisely so the FAILURE audit is
    // written outside the aborting transaction - and an audit failure there
    // must not replace the error the caller actually needs to see.
    it("keeps the use case's own error when the FAILURE audit also fails", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("use case failed"));
      writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

      await expect(
        withAudit(fn, dataBuilder)("arg0", "my-session"),
      ).rejects.toThrow("use case failed");
    });
  });
});
