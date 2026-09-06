import { validateAuditEvent } from "@defra/fcp-audit-publisher";
import { getTraceId } from "@defra/hapi-tracing";
import { networkInterfaces } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Outbox } from "../grants/models/outbox.js";
import { insertMany } from "../grants/repositories/outbox.repository.js";
import { auditStatus } from "./audit-constants.js";
import { getRequestContext } from "./get-request-context.js";
import {
  buildPayload,
  createAuditPayload,
  stripNulls,
  writeAuditEvent,
} from "./write-audit-event.js";

vi.mock("@defra/hapi-tracing", () => ({
  getTraceId: vi.fn(),
}));

vi.mock("./config.js", () => ({
  config: {
    serviceVersion: "1.0.0",
    serviceName: "fg-gas-backend",
    cdpEnvironment: "test",
    sns: { auditTopicArn: "arn:aws:sns:eu-west-2:123:audit-topic" },
  },
}));

vi.mock("./logger.js");

vi.mock("./get-request-context.js", () => ({
  getRequestContext: vi.fn(),
}));

vi.mock("../grants/models/outbox.js", () => ({
  Outbox: vi.fn(),
}));

vi.mock("../grants/repositories/outbox.repository.js", () => ({
  insertMany: vi.fn(),
}));

vi.mock("node:os", () => ({
  networkInterfaces: vi.fn(() => ({
    eth0: [{ family: "IPv4", address: "10.1.2.3", internal: false }],
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getTraceId.mockReturnValue("trace-id-123");
  getRequestContext.mockReturnValue(null);
  Outbox.mockImplementation(function (data) {
    Object.assign(this, data);
  });
  insertMany.mockResolvedValue(undefined);
});

// The shape the audit schema actually accepts - see buildAuditEvent.
const auditEntities = [
  { entity: "APPLICATION", action: "SUBMIT", entityid: "app-1" },
];

describe("createAuditPayload", () => {
  it("should omit accounts if sbi, crn and frn are undefined", () => {
    const result = createAuditPayload({
      accountDetails: {},
      entities: auditEntities,
      status: auditStatus.SUCCESS,
    });

    expect(result).toEqual({
      entities: auditEntities,
      status: auditStatus.SUCCESS,
    });
  });

  it("should include accounts if either sbi, crn or frn are present", () => {
    const result = createAuditPayload({
      accountDetails: { sbi: "SBI" },
      entities: auditEntities,
      status: "FOO",
    });
    expect(result).toEqual({
      accounts: { sbi: "SBI", frn: undefined, crn: undefined },
      entities: auditEntities,
      status: "FOO",
    });
  });

  it("returns entities, status", () => {
    const result = createAuditPayload({
      accountDetails: { sbi: "999-000" },
      entities: auditEntities,
      status: auditStatus.SUCCESS,
    });

    expect(result).toEqual({
      accounts: { sbi: "999-000" },
      entities: auditEntities,
      status: auditStatus.SUCCESS,
    });
  });
});

describe("buildPayload", () => {
  it("includes service metadata from config", () => {
    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result).toMatchObject({
      version: "1.0.0",
      application: "Grants Platform",
      component: "fg-gas-backend",
      environment: "test",
    });
  });

  it("uses correlationid from getTraceId when available", () => {
    getTraceId.mockReturnValue("my-trace-id");

    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.correlationid).toBe("my-trace-id");
  });

  it("falls back to a uuid for correlationid when getTraceId returns null", () => {
    getTraceId.mockReturnValue(null);

    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.correlationid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("sets user from context", () => {
    const result = buildPayload(
      { user: "user-abc" },
      { entities: [], details: {}, status: auditStatus.SUCCESS },
    );

    expect(result.user).toBe("user-abc");
  });

  it("sets sessionid from context", () => {
    const result = buildPayload(
      { sessionId: "sess-xyz" },
      { entities: [], details: {}, status: auditStatus.SUCCESS },
    );

    expect(result.sessionid).toBe("sess-xyz");
  });

  it("uses ip from context when present", () => {
    const result = buildPayload(
      { ip: "10.0.0.1" },
      { entities: [], details: {}, status: auditStatus.SUCCESS },
    );

    expect(result.ip).toBe("10.0.0.1");
  });

  it("falls back to service ip from networkInterfaces when context has no ip", () => {
    networkInterfaces.mockReturnValue({
      eth0: [{ family: "IPv4", address: "192.168.1.10", internal: false }],
    });

    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.ip).toBe("192.168.1.10");
  });

  it("sets ip to null when no external IPv4 interface is available", () => {
    networkInterfaces.mockReturnValue({
      lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    });

    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.ip).toBeNull();
  });

  it("sets user, sessionid to undefined when context is null", () => {
    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.user).toBeUndefined();
    expect(result.sessionid).toBeUndefined();
  });

  it("sets user, sessionid to undefined when context values are null", () => {
    const result = buildPayload(
      { user: null, sessionId: null },
      { entities: [], details: {}, status: auditStatus.SUCCESS },
    );

    expect(result.user).toBeUndefined();
    expect(result.sessionid).toBeUndefined();
  });

  it("wraps security when provided", () => {
    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
      security: { userId: "u-1" },
    });

    expect(result.security).toEqual({ userId: "u-1" });
  });

  it("sets security to undefined when not provided", () => {
    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.security).toBeUndefined();
  });

  it("includes a datetime ISO string", () => {
    const result = buildPayload(null, {
      entities: [],
      details: {},
      status: auditStatus.SUCCESS,
    });

    expect(result.datetime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
    );
  });
});

describe("writeAuditEvent", () => {
  const eventData = {
    entities: auditEntities,
    accounts: { sbi: "sbi-1", frn: "frn-1", crn: "crn-1" },
    details: { code: "woodlands" },
    status: auditStatus.SUCCESS,
    security: undefined,
  };

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("inserts an outbox entry on a valid payload", async () => {
    const session = {};
    getRequestContext.mockReturnValue({ user: "u-1", ip: "10.0.0.1" });

    await writeAuditEvent(eventData, session);

    expect(insertMany).toHaveBeenCalledOnce();
    expect(insertMany).toHaveBeenCalledWith([expect.any(Object)], session);
  });

  it("constructs Outbox with event, target arn and segregationRef", async () => {
    getRequestContext.mockReturnValue(null);

    await writeAuditEvent(eventData, {});

    expect(Outbox).toHaveBeenCalledWith({
      event: expect.objectContaining({ application: "Grants Platform" }),
      target: "arn:aws:sns:eu-west-2:123:audit-topic",
      segregationRef: expect.stringMatching(uuidPattern),
    });
  });

  it("publishes an event that satisfies the audit schema", async () => {
    await writeAuditEvent(eventData, {});

    const [{ event }] = Outbox.mock.calls[0];
    const { valid, errors } = validateAuditEvent(event);

    expect(errors).toBeUndefined();
    expect(valid).toBe(true);
  });

  it("keeps messageGroupId out of the published event payload", async () => {
    getRequestContext.mockReturnValue(null);

    await writeAuditEvent(eventData, {});

    const [{ event }] = Outbox.mock.calls[0];
    expect(event).not.toHaveProperty("messageGroupId");
  });

  it("uses the caller-supplied segregationRef without publishing it", async () => {
    await writeAuditEvent(
      { ...eventData, segregationRef: "submission-client-1" },
      {},
    );

    const [{ segregationRef, event }] = Outbox.mock.calls[0];
    expect(segregationRef).toBe("submission-client-1");
    expect(event).not.toHaveProperty("segregationRef");
  });

  it("groups repeat events from the same caller under one segregationRef", async () => {
    const grouped = { ...eventData, segregationRef: "submission-client-1" };

    await writeAuditEvent(grouped, {});
    await writeAuditEvent(grouped, {});

    const [{ segregationRef: first }] = Outbox.mock.calls[0];
    const [{ segregationRef: second }] = Outbox.mock.calls[1];

    expect(first).toBe(second);
  });

  it("falls back to a unique uuid segregationRef when the caller provides none", async () => {
    await writeAuditEvent(eventData, {});
    await writeAuditEvent(eventData, {});

    const [{ segregationRef: first }] = Outbox.mock.calls[0];
    const [{ segregationRef: second }] = Outbox.mock.calls[1];

    expect(first).toMatch(uuidPattern);
    expect(second).toMatch(uuidPattern);
    expect(first).not.toBe(second);
  });

  it("includes accounts in the outbox event audit payload", async () => {
    await writeAuditEvent(eventData, {});

    expect(Outbox).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          audit: expect.objectContaining({
            accounts: { sbi: "sbi-1", frn: "frn-1", crn: "crn-1" },
          }),
        }),
      }),
    );
  });

  it("nests details under audit rather than at the top level", async () => {
    await writeAuditEvent(eventData, {});

    const storedEvent = Outbox.mock.calls[0][0].event;
    expect(storedEvent).not.toHaveProperty("details");
    expect(storedEvent.audit).toMatchObject({ details: { code: "woodlands" } });
  });

  it("strips null user and sessionid from the payload before validation", async () => {
    getRequestContext.mockReturnValue({ user: null, sessionId: null });

    await writeAuditEvent(eventData, {});

    const storedEvent = Outbox.mock.calls[0][0].event;
    expect(storedEvent).not.toHaveProperty("user");
    expect(storedEvent).not.toHaveProperty("sessionid");
  });

  it("strips undefined user and sessionid from the payload when context is null", async () => {
    await writeAuditEvent(eventData, {});

    const storedEvent = Outbox.mock.calls[0][0].event;
    expect(storedEvent).not.toHaveProperty("user");
    expect(storedEvent).not.toHaveProperty("sessionid");
  });

  it("strips undefined user and sessionid from the payload when context values are undefined", async () => {
    getRequestContext.mockReturnValue({
      user: undefined,
      sessionId: undefined,
    });

    await writeAuditEvent(eventData, {});

    const storedEvent = Outbox.mock.calls[0][0].event;
    expect(storedEvent).not.toHaveProperty("user");
    expect(storedEvent).not.toHaveProperty("sessionid");
  });

  it("strips null entries for account", () => {
    const payload = {
      context: {
        user: "julian",
      },
      account: {
        sbi: null,
      },
    };
    const result = stripNulls(payload);
    expect(result.account).not.toHaveProperty("sbi");
  });

  it("skips insertMany when payload fails validation", async () => {
    await writeAuditEvent({ ...eventData, entities: "not-an-array" }, {});

    expect(insertMany).not.toHaveBeenCalled();
  });

  it("reads request context via getRequestContext", async () => {
    getRequestContext.mockReturnValue({ user: "ctx-user", ip: "1.2.3.4" });

    await writeAuditEvent(eventData, {});

    expect(getRequestContext).toHaveBeenCalledOnce();
  });

  it("passes the session through to insertMany", async () => {
    const session = { id: "mongo-session" };

    await writeAuditEvent(eventData, session);

    expect(insertMany).toHaveBeenCalledWith(expect.any(Array), session);
  });
});
