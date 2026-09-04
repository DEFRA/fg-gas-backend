import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import {
  findStatusById as gasInboxStatus,
  parkById as parkGasInbox,
  unparkById as unparkGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  parkById as parkGasOutbox,
  unparkById as unparkGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import {
  parkCwEvent,
  unparkCwEvent,
} from "../repositories/cw-actuators.repository.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/write-audit-event.js");
vi.mock("../../grants/repositories/inbox.repository.js", () => ({
  findStatusById: vi.fn(),
  parkById: vi.fn(),
  unparkById: vi.fn(),
}));
vi.mock("../../grants/repositories/outbox.repository.js", () => ({
  findStatusById: vi.fn(),
  parkById: vi.fn(),
  unparkById: vi.fn(),
}));
vi.mock("../../common/config.js", () => ({
  config: {
    inbox: { inboxMaxRetries: 5 },
    outbox: { outboxMaxRetries: 4 },
    cwBackend: { url: "http://cw.test", token: "cw-token" },
    httpClient: { timeoutMs: 3000 },
    tracingHeader: "x-cdp-request-id",
  },
}));
vi.mock(
  "../repositories/cw-actuators.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    parkCwEvent: vi.fn(),
    unparkCwEvent: vi.fn(),
  }),
);

const { parkEventUseCase, unparkEventUseCase } =
  await import("./park-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const aParkedGasInboxDoc = (overrides = {}) => ({
  _id: ID,
  messageId: "msg-1",
  type: "cloud.defra.prd.fg-gas-backend.case.create",
  source: "GAS",
  segregationRef: "GLD-9B2",
  status: "PARKED",
  completionAttempts: 5,
  eventTime: "2026-06-16T10:00:00.000Z",
  lastError: { name: "TypeError", message: "boom", at: null },
  parked: {
    at: "2026-06-16T11:00:00.000Z",
    reason: "poison",
    by: "donatas",
  },
  lastRedrive: null,
  ...overrides,
});

const aCwRow = (overrides = {}) => ({
  _id: ID,
  eventId: "evt-1",
  type: "cloud.defra.local.fg-cw-backend.case.create",
  source: "CW",
  segregationRef: "GLD-9B2",
  status: "PARKED",
  completionAttempts: 5,
  maxAttempts: 5,
  traceparent: null,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: null,
  lastError: null,
  completedAt: null,
  parked: { at: "2026-06-16T11:00:00.000Z", reason: "poison", by: "donatas" },
  lastRedrive: null,
  ...overrides,
});

const park = (overrides = {}) =>
  parkEventUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    reason: "poison",
    caller: "admin-ui",
    ...overrides,
  });

const unpark = (overrides = {}) =>
  unparkEventUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    caller: "admin-ui",
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parkEventUseCase gas", () => {
  it("issues the conditional update with the reason and the actor", async () => {
    parkGasInbox.mockResolvedValue(aParkedGasInboxDoc());

    await park({ actor: "donatas" });

    expect(parkGasInbox).toHaveBeenCalledWith(ID, {
      reason: "poison",
      by: "donatas",
    });
    expect(parkCwEvent).not.toHaveBeenCalled();
  });

  it("answers with the row exactly as the list renders it", async () => {
    parkGasInbox.mockResolvedValue(aParkedGasInboxDoc());

    const { event } = await park();

    expect(event.status).toBe("PARKED");
    expect(event.parked).toEqual({
      at: "2026-06-16T11:00:00.000Z",
      reason: "poison",
      by: "donatas",
    });
    expect(event.type).toBe("case.create");
  });

  it("uses the outbox repository for box=outbox", async () => {
    parkGasOutbox.mockResolvedValue({
      _id: ID,
      status: "PARKED",
      completionAttempts: 5,
      event: { id: "evt-1", type: "cloud.defra.prd.svc.case.create" },
      publicationDate: new Date("2026-06-16T10:00:00.000Z"),
      parked: { at: null, reason: "poison", by: null },
    });

    await park({ box: "outbox" });

    expect(parkGasOutbox).toHaveBeenCalled();
    expect(parkGasInbox).not.toHaveBeenCalled();
  });

  it("is a 404 when the row does not exist", async () => {
    parkGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue(null);

    await expect(park()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("is a 409 naming the status that blocked it", async () => {
    parkGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await expect(park()).rejects.toMatchObject({
      output: { statusCode: 409, payload: { status: "COMPLETED" } },
    });
  });

  it("only reads the status on the failure path", async () => {
    parkGasInbox.mockResolvedValue(aParkedGasInboxDoc());

    await park();

    expect(gasInboxStatus).not.toHaveBeenCalled();
  });
});

describe("parkEventUseCase caseworking", () => {
  it("forwards the reason and the actor to the Caseworking actuator", async () => {
    parkCwEvent.mockResolvedValue(aCwRow());

    await park({ service: "caseworking", actor: "donatas" });

    expect(parkCwEvent).toHaveBeenCalledWith("inbox", ID, {
      reason: "poison",
      by: "donatas",
    });
    expect(parkGasInbox).not.toHaveBeenCalled();
  });

  it("maps the Caseworking row into the same shape a GAS one gets", async () => {
    parkCwEvent.mockResolvedValue(aCwRow());

    const { event } = await park({ service: "caseworking" });

    expect(event.service).toBe("caseworking");
    expect(event.status).toBe("PARKED");
    expect(event.parked.reason).toBe("poison");
  });
});

describe("unparkEventUseCase", () => {
  it("issues the conditional update by id", async () => {
    unparkGasInbox.mockResolvedValue(
      aParkedGasInboxDoc({ status: "DEAD_LETTER", parked: null }),
    );

    const { event } = await unpark();

    expect(unparkGasInbox).toHaveBeenCalledWith(ID);
    expect(event.status).toBe("DEAD_LETTER");
    expect(event.parked).toBeNull();
  });

  it("uses the outbox repository for box=outbox", async () => {
    unparkGasOutbox.mockResolvedValue({
      _id: ID,
      status: "DEAD_LETTER",
      completionAttempts: 5,
      event: { id: "evt-1", type: "cloud.defra.prd.svc.case.create" },
      publicationDate: new Date("2026-06-16T10:00:00.000Z"),
      parked: null,
    });

    await unpark({ box: "outbox" });

    expect(unparkGasOutbox).toHaveBeenCalled();
  });

  it("forwards to Caseworking with the actor", async () => {
    unparkCwEvent.mockResolvedValue(
      aCwRow({ status: "DEAD_LETTER", parked: null }),
    );

    await unpark({ service: "caseworking", actor: "donatas" });

    expect(unparkCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: "donatas",
    });
  });

  it("is a 409 saying the row is not PARKED", async () => {
    unparkGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue("DEAD_LETTER");

    await expect(unpark()).rejects.toMatchObject({
      output: { statusCode: 409, payload: { status: "DEAD_LETTER" } },
    });
  });

  it("is a 404 when the row does not exist", async () => {
    unparkGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue(null);

    await expect(unpark()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});

describe("park and unpark audit", () => {
  it("records who parked what, and why", async () => {
    parkGasInbox.mockResolvedValue(aParkedGasInboxDoc());

    await park({ actor: "donatas" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.PARK_EVENT,
            entityid: ID,
          },
        ],
        details: {
          service: "gas",
          box: "inbox",
          reason: "poison",
          caller: "admin-ui",
          actor: "donatas",
        },
      }),
      undefined,
    );
  });

  it("records an unattributed park as a null actor rather than omitting the key", async () => {
    parkGasInbox.mockResolvedValue(aParkedGasInboxDoc());

    await park();

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ actor: null }),
      }),
      undefined,
    );
  });

  it("audits a refused park as a FAILURE - it is still an attempt", async () => {
    parkGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await park().catch(() => {});

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
      null,
    );
  });

  it("audits an unpark under its own action", async () => {
    unparkGasInbox.mockResolvedValue(
      aParkedGasInboxDoc({ status: "DEAD_LETTER", parked: null }),
    );

    await unpark({ actor: "donatas" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.UNPARK_EVENT,
            entityid: ID,
          },
        ],
        details: {
          service: "gas",
          box: "inbox",
          caller: "admin-ui",
          actor: "donatas",
        },
      }),
      undefined,
    );
  });
});
