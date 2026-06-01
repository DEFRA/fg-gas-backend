import {
  publishAuditEvent,
  validateAuditEvent,
} from "@defra/fcp-audit-publisher";
import { getTraceId } from "@defra/hapi-tracing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { withRequestContext } from "./request-context.js";
import { withAuditEvents } from "./with-audit-events.js";

vi.mock("@defra/fcp-audit-publisher", () => ({
  validateAuditEvent: vi.fn(),
  publishAuditEvent: vi.fn(),
}));
vi.mock("@defra/hapi-tracing", () => ({ getTraceId: vi.fn() }));
vi.mock("./config.js", () => ({
  config: {
    cdpEnvironment: "test",
    serviceName: "fg-gas",
    serviceVersion: "1.0.0",
    sns: { auditTopicArn: "arn:aws:sns:eu-west-2:123:audit" },
  },
}));
vi.mock("./logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("./sns-client.js", () => ({ snsClient: {} }));

const context = {
  user: "user-1",
  subject: null,
  sessionId: "sess-1",
  ip: "1.2.3.4",
};

const validAuditEvent = () => ({
  audit: {
    entities: [{ entity: "Thing", action: "DO_THING", entityid: "id-1" }],
  },
});

describe("withAuditEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getTraceId.mockReturnValue("trace-abc");
    validateAuditEvent.mockReturnValue({ valid: true, value: {} });
    publishAuditEvent.mockResolvedValue(undefined);
  });

  it("returns the use-case result on success", async () => {
    const useCase = vi.fn().mockResolvedValue("ok");
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    const result = await withRequestContext(context, () => wrapped("arg1"));

    expect(result).toBe("ok");
  });

  it("publishes an audit event with SUCCESS status on success", async () => {
    const useCase = vi.fn().mockResolvedValue({ id: 42 });
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await withRequestContext(context, () => wrapped("arg1"));

    expect(publishAuditEvent).toHaveBeenCalledOnce();
    const [payload] = publishAuditEvent.mock.calls[0];
    expect(payload.audit.status).toBe("SUCCESS");
    expect(payload.user).toBe("user-1");
    expect(payload.correlationid).toBe("trace-abc");
    expect(payload.ip).toBe("1.2.3.4");
  });

  it("re-throws and publishes FAILURE status when use-case throws", async () => {
    const error = new Error("boom");
    const useCase = vi.fn().mockRejectedValue(error);
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await expect(withRequestContext(context, () => wrapped())).rejects.toThrow(
      "boom",
    );

    expect(publishAuditEvent).toHaveBeenCalledOnce();
    const [payload] = publishAuditEvent.mock.calls[0];
    expect(payload.audit.status).toBe("FAILURE");
  });

  it("injects subject into audit.details when present in context", async () => {
    const ctxWithSubject = { ...context, subject: "farmer-99" };
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => ({
      audit: {
        entities: [{ entity: "Thing", action: "DO_THING" }],
        details: { code: "ABC" },
      },
    }));

    await withRequestContext(ctxWithSubject, () => wrapped());

    expect(publishAuditEvent).toHaveBeenCalledOnce();
    const [payload] = publishAuditEvent.mock.calls[0];
    expect(payload.audit.details.subject).toBe("farmer-99");
    expect(payload.audit.details.code).toBe("ABC");
  });

  it("does not inject subject when not present in context", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => ({
      audit: {
        entities: [{ entity: "Thing", action: "DO_THING" }],
        details: {},
      },
    }));

    await withRequestContext(context, () => wrapped());

    expect(publishAuditEvent).toHaveBeenCalledOnce();
    const [payload] = publishAuditEvent.mock.calls[0];
    expect(payload.audit.details).not.toHaveProperty("subject");
  });

  it("omits user and sessionid when no request context", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await wrapped();

    expect(publishAuditEvent).toHaveBeenCalledOnce();
    const [payload] = publishAuditEvent.mock.calls[0];
    expect(payload.user).toBeUndefined();
    expect(payload.sessionid).toBeUndefined();
  });

  it("logs a warning and skips publish when validation fails", async () => {
    validateAuditEvent.mockReturnValue({
      valid: false,
      errors: ["missing entities"],
    });
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await withRequestContext(context, () => wrapped());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errors: ["missing entities"] }),
      "Audit event failed validation - not publishing",
    );
    expect(publishAuditEvent).not.toHaveBeenCalled();
  });

  it("does not surface publish errors to the caller", async () => {
    publishAuditEvent.mockRejectedValue(new Error("SNS down"));
    const useCase = vi.fn().mockResolvedValue("result");
    const wrapped = withAuditEvents(useCase, () => validAuditEvent());

    await expect(withRequestContext(context, () => wrapped())).resolves.toBe(
      "result",
    );

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to publish audit event",
    );
  });
});
