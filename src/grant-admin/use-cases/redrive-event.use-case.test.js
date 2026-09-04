import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import {
  findStatusById as gasInboxStatus,
  redriveById as redriveGasInbox,
} from "../../grants/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  redriveById as redriveGasOutbox,
} from "../../grants/repositories/outbox.repository.js";
import { redriveCwEvent } from "../repositories/cw-actuators.repository.js";
import {
  redriveEventAuditBuilder,
  redriveEventUseCase,
} from "./redrive-event.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/write-audit-event.js");
vi.mock("../../grants/repositories/inbox.repository.js");
vi.mock("../../grants/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

// what the GAS repositories answer with: the raw updated document in the list
// projection, no payload
const aRedrivenGasInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(ID),
  messageId: "msg-1",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: "GLD-9B2",
  status: "RESUBMITTED",
  completionAttempts: 0,
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  eventTime: "2026-06-16T10:00:00.000Z",
  lastResubmissionDate: "2026-06-16T10:05:00.000Z",
  completionDate: null,
  lastError: { name: "TypeError", message: "boom", at: null },
  ...overrides,
});

// what CW's redrive endpoint answers with: one pre-flattened list row
const aCwRow = (overrides = {}) => ({
  _id: ID,
  eventId: "msg-1",
  type: "cloud.defra.prd.fg-gas-backend.case.create.new",
  source: "GAS",
  segregationRef: "GLD-9B2",
  status: "RESUBMITTED",
  completionAttempts: 0,
  maxAttempts: 7,
  traceparent: null,
  createdAt: "2026-06-16T10:00:00.000Z",
  lastFailureAt: null,
  lastError: null,
  completedAt: null,
  ...overrides,
});

const call = (overrides = {}) =>
  redriveEventUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    caller: "grants-ui",
    ...overrides,
  });

describe("redriveEventUseCase gas", () => {
  it("issues the conditional update against its own collection", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    await call();

    expect(redriveGasInbox).toHaveBeenCalledWith(ID, { by: undefined });
    expect(redriveCwEvent).not.toHaveBeenCalled();
  });

  it("answers with the updated row under `event`", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    const result = await call();

    expect(result.event).toMatchObject({
      service: "gas",
      box: "inbox",
      id: ID,
      status: "RESUBMITTED",
      attempts: 0,
      maxAttempts: 5,
    });
  });

  it("carries no payload on the redrive response", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    expect((await call()).event).not.toHaveProperty("payload");
  });

  it("uses the outbox repository for box=outbox", async () => {
    redriveGasOutbox.mockResolvedValue({
      _id: new ObjectId(ID),
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__x.fifo",
      status: "RESUBMITTED",
      completionAttempts: 0,
      publicationDate: new Date("2026-06-16T10:00:00.000Z"),
      event: { id: "evt-2", type: "a.b.c" },
    });

    const result = await call({ box: "outbox" });

    expect(redriveGasOutbox).toHaveBeenCalledWith(ID, { by: undefined });
    expect(result.event.box).toBe("outbox");
  });

  it("does not read the status again on the happy path", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    await call();

    expect(gasInboxStatus).not.toHaveBeenCalled();
  });

  it("404s when the update matched nothing and the row is gone", async () => {
    redriveGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("409s with the current status when the row is no longer DEAD_LETTER", async () => {
    redriveGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await expect(call()).rejects.toMatchObject({
      output: { payload: { statusCode: 409, status: "COMPLETED" } },
    });
  });

  // the race: the row was DEAD_LETTER when the page rendered, but the poller
  // moved it before the update landed. One conditional update, nothing
  // clobbered, and the caller is told what it is now.
  it("loses cleanly to a concurrent state change", async () => {
    redriveGasOutbox.mockResolvedValue(null);
    gasOutboxStatus.mockResolvedValue("PROCESSING");

    await expect(call({ box: "outbox" })).rejects.toMatchObject({
      output: { payload: { status: "PROCESSING" } },
    });
    expect(redriveGasOutbox).toHaveBeenCalledTimes(1);
  });
});

describe("redriveEventUseCase caseworking", () => {
  it("calls the caseworking actuator redrive endpoint", async () => {
    redriveCwEvent.mockResolvedValue(aCwRow());

    await call({ service: "caseworking" });

    expect(redriveCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: undefined,
    });
    expect(redriveGasInbox).not.toHaveBeenCalled();
  });

  it("normalises the caseworking row into the list shape", async () => {
    redriveCwEvent.mockResolvedValue(aCwRow());

    const result = await call({ service: "caseworking" });

    expect(result.event).toMatchObject({
      service: "caseworking",
      box: "inbox",
      id: ID,
      eventId: "msg-1",
      status: "RESUBMITTED",
      attempts: 0,
      maxAttempts: 7,
    });
  });

  it("passes a caseworking 409 through untouched", async () => {
    const conflict = {
      output: { statusCode: 409, payload: { status: "COMPLETED" } },
    };
    redriveCwEvent.mockRejectedValue(
      Object.assign(new Error("nope"), conflict),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject(
      conflict,
    );
  });

  it("passes a caseworking 404 through untouched", async () => {
    redriveCwEvent.mockRejectedValue(
      Object.assign(new Error("gone"), { output: { statusCode: 404 } }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});

describe("redriveEventUseCase audit", () => {
  it("records who redrove what", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    await call({ caller: "admin-ui" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.REDRIVE_EVENT,
            entityid: ID,
          },
        ],
        details: {
          service: "gas",
          box: "inbox",
          caller: "admin-ui",
          actor: null,
        },
      }),
      undefined,
    );
  });

  it("audits a refused redrive as a FAILURE and still rethrows", async () => {
    redriveGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
      null,
    );
  });
});

describe("redriveEventAuditBuilder", () => {
  it("builds an EVENT/REDRIVE_EVENT entity keyed on the event id", () => {
    const built = redriveEventAuditBuilder([
      { service: "caseworking", box: "outbox", id: ID, caller: "grants-ui" },
    ]);

    expect(built.entities).toEqual([
      {
        entity: auditEntities.EVENT,
        action: auditActions.REDRIVE_EVENT,
        entityid: ID,
      },
    ]);
    expect(built.segregationRef).toBe(`event-${ID}`);
  });
});

describe("redriveEventUseCase actor", () => {
  it("persists the actor on the GAS row as lastRedrive.by", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    await call({ actor: "donatas" });

    expect(redriveGasInbox).toHaveBeenCalledWith(ID, { by: "donatas" });
  });

  it("forwards the actor to Caseworking", async () => {
    redriveCwEvent.mockResolvedValue(aCwRow());

    await call({ service: "caseworking", actor: "donatas" });

    expect(redriveCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: "donatas",
    });
  });

  it("records the actor alongside the caller in the audit event", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    await call({ caller: "admin-ui", actor: "donatas" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ actor: "donatas" }),
      }),
      undefined,
    );
  });
});
