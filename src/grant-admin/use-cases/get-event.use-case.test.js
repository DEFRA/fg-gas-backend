import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { findById as findGasInboxById } from "../../grants/repositories/inbox.repository.js";
import { findById as findGasOutboxById } from "../../grants/repositories/outbox.repository.js";
import { findCwEvent } from "../repositories/cw-actuators.repository.js";
import { getEventAuditBuilder, getEventUseCase } from "./get-event.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/write-audit-event.js");
vi.mock("../../grants/repositories/inbox.repository.js");
vi.mock("../../grants/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const aGasInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(ID),
  messageId: "msg-1",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: "GLD-9B2",
  status: "DEAD_LETTER",
  completionAttempts: 5,
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  eventTime: "2026-06-16T10:00:00.000Z",
  lastResubmissionDate: null,
  completionDate: null,
  lastError: null,
  event: { id: "evt-1", data: { clientRef: "REF-1" } },
  ...overrides,
});

const aCwInboxDoc = (overrides = {}) => ({
  ...aGasInboxDoc(),
  _id: ID,
  maxAttempts: 7,
  ...overrides,
});

const call = (overrides = {}) =>
  getEventUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    caller: "grants-ui",
    ...overrides,
  });

describe("getEventUseCase gas", () => {
  it("reads its own inbox collection by id", async () => {
    findGasInboxById.mockResolvedValue(aGasInboxDoc());

    await call();

    expect(findGasInboxById).toHaveBeenCalledWith(ID);
    expect(findCwEvent).not.toHaveBeenCalled();
  });

  it("reads its own outbox collection for box=outbox", async () => {
    findGasOutboxById.mockResolvedValue({
      _id: new ObjectId(ID),
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__x.fifo",
      status: "COMPLETED",
      completionAttempts: 1,
      publicationDate: new Date("2026-06-16T10:00:00.000Z"),
      event: { id: "evt-2", type: "a.b.c" },
    });

    const detail = await call({ box: "outbox" });

    expect(findGasOutboxById).toHaveBeenCalledWith(ID);
    expect(detail.box).toBe("outbox");
  });

  it("returns a normalised detail with the payload attached", async () => {
    findGasInboxById.mockResolvedValue(aGasInboxDoc());

    const detail = await call();

    expect(detail.service).toBe("gas");
    expect(detail.id).toBe(ID);
    expect(detail.payload).toEqual({
      id: "evt-1",
      data: { clientRef: "REF-1" },
    });
  });

  it("stamps GAS's own retry cap", async () => {
    findGasInboxById.mockResolvedValue(aGasInboxDoc());

    expect((await call()).maxAttempts).toBe(5);
  });

  it("404s when there is no such row", async () => {
    findGasInboxById.mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});

describe("getEventUseCase caseworking", () => {
  it("calls the caseworking actuator detail endpoint", async () => {
    findCwEvent.mockResolvedValue(aCwInboxDoc());

    await call({ service: "caseworking" });

    expect(findCwEvent).toHaveBeenCalledWith("inbox", ID);
    expect(findGasInboxById).not.toHaveBeenCalled();
  });

  it("uses the maxAttempts caseworking reported, not GAS's", async () => {
    findCwEvent.mockResolvedValue(aCwInboxDoc());

    expect((await call({ service: "caseworking" })).maxAttempts).toBe(7);
  });

  it("returns the caseworking payload", async () => {
    findCwEvent.mockResolvedValue(aCwInboxDoc());

    const detail = await call({ service: "caseworking" });

    expect(detail.service).toBe("caseworking");
    expect(detail.payload).toEqual({
      id: "evt-1",
      data: { clientRef: "REF-1" },
    });
  });

  it("passes a caseworking failure through untouched", async () => {
    findCwEvent.mockRejectedValue(
      Object.assign(new Error("bad gateway"), {
        output: { statusCode: 502 },
      }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });
});

describe("getEventUseCase audit", () => {
  it("writes an audit event for a successful view", async () => {
    findGasInboxById.mockResolvedValue(aGasInboxDoc());

    await call();

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.VIEW_EVENT,
            entityid: ID,
          },
        ],
      }),
      undefined,
    );
  });

  it("records the service, box and caller on the audit event", async () => {
    findGasOutboxById.mockResolvedValue({
      _id: new ObjectId(ID),
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__x.fifo",
      status: "COMPLETED",
      completionAttempts: 1,
      publicationDate: new Date("2026-06-16T10:00:00.000Z"),
      event: { id: "evt-2", type: "a.b.c" },
    });

    await call({ service: "gas", box: "outbox", caller: "admin-ui" });

    const [payload] = writeAuditEvent.mock.calls.at(-1);

    expect(payload.details).toEqual({
      service: "gas",
      box: "outbox",
      caller: "admin-ui",
    });
  });

  it("audits a refused view as a FAILURE and still rethrows", async () => {
    findGasInboxById.mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
      null,
    );
  });
});

describe("getEventAuditBuilder", () => {
  it("builds an EVENT/VIEW_EVENT entity keyed on the event id", () => {
    const built = getEventAuditBuilder([
      { service: "caseworking", box: "outbox", id: ID, caller: "grants-ui" },
    ]);

    expect(built.entities).toEqual([
      {
        entity: auditEntities.EVENT,
        action: auditActions.VIEW_EVENT,
        entityid: ID,
      },
    ]);
    expect(built.details).toEqual({
      service: "caseworking",
      box: "outbox",
      caller: "grants-ui",
    });
  });

  it("groups outbox work for one event under a shared segregationRef", () => {
    expect(
      getEventAuditBuilder([{ service: "gas", box: "inbox", id: ID }])
        .segregationRef,
    ).toBe(`event-${ID}`);
  });
});
