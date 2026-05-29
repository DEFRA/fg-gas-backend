import { getTraceId } from "@defra/hapi-tracing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";
import { withRequestContext } from "./request-context.js";
import { publish } from "./sns-client.js";
import { withAuditEvents } from "./with-audit-events.js";

vi.mock("@defra/hapi-tracing", () => ({ getTraceId: vi.fn() }));
vi.mock("./config.js", () => ({
  config: {
    cdpEnvironment: "test",
    serviceName: "fg-gas",
    sns: { auditTopicArn: "arn:aws:sns:eu-west-2:123:audit" },
  },
}));
vi.mock("./logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("./sns-client.js", () => ({ publish: vi.fn() }));

const context = {
  user: "user-1",
  subject: null,
  sessionId: "sess-1",
  ip: "1.2.3.4",
};

describe("withAuditEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getTraceId.mockReturnValue("trace-abc");
    publish.mockResolvedValue(undefined);
  });

  it("returns the use-case result on success", async () => {
    const useCase = vi.fn().mockResolvedValue("ok");
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "Test" },
    }));

    const result = await withRequestContext(context, () => wrapped("arg1"));

    expect(result).toBe("ok");
  });

  it("publishes an audit event with status SUCCESS on success", async () => {
    const useCase = vi.fn().mockResolvedValue({ id: 42 });
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "TestEvent", action: "DO_THING" },
    }));

    await withRequestContext(context, () => wrapped("arg1"));

    expect(publish).toHaveBeenCalledOnce();
    const [topicArn, payload] = publish.mock.calls[0];
    expect(topicArn).toBe("arn:aws:sns:eu-west-2:123:audit");
    expect(payload.audit.status).toBe("SUCCESS");
    expect(payload.audit.eventtype).toBe("TestEvent");
    expect(payload.user).toBe("user-1");
    expect(payload.correlationId).toBe("trace-abc");
    expect(payload.environment).toBe("test");
    expect(payload.application).toBe("fg-gas");
  });

  it("re-throws and publishes FAILURE status when use-case throws", async () => {
    const error = new Error("boom");
    const useCase = vi.fn().mockRejectedValue(error);
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "TestEvent" },
    }));

    await expect(withRequestContext(context, () => wrapped())).rejects.toThrow(
      "boom",
    );

    expect(publish).toHaveBeenCalledOnce();
    const [, payload] = publish.mock.calls[0];
    expect(payload.audit.status).toBe("FAILURE");
  });

  it("injects subject into audit.details when present in context", async () => {
    const ctxWithSubject = { ...context, subject: "farmer-99" };
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "TestEvent", details: { code: "ABC" } },
    }));

    await withRequestContext(ctxWithSubject, () => wrapped());

    expect(publish).toHaveBeenCalledOnce();
    const [, payload] = publish.mock.calls[0];
    expect(payload.audit.details.subject).toBe("farmer-99");
    expect(payload.audit.details.code).toBe("ABC");
  });

  it("does not inject subject when not present in context", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "TestEvent", details: {} },
    }));

    await withRequestContext(context, () => wrapped());

    expect(publish).toHaveBeenCalledOnce();
    const [, payload] = publish.mock.calls[0];
    expect(payload.audit.details).not.toHaveProperty("subject");
  });

  it("publishes with null identity fields when no request context", async () => {
    const useCase = vi.fn().mockResolvedValue(undefined);
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "TestEvent" },
    }));

    await wrapped();

    expect(publish).toHaveBeenCalledOnce();
    const [, payload] = publish.mock.calls[0];
    expect(payload.user).toBeNull();
    expect(payload.ip).toBeNull();
    expect(payload.sessionid).toBeNull();
  });

  it("does not surface publish errors to the caller", async () => {
    publish.mockRejectedValue(new Error("SNS down"));
    const useCase = vi.fn().mockResolvedValue("result");
    const wrapped = withAuditEvents(useCase, () => ({
      audit: { eventtype: "TestEvent" },
    }));

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
