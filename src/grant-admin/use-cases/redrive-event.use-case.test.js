import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { withTransaction } from "../../common/with-transaction.js";
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
vi.mock("../../common/with-transaction.js");
vi.mock("../../common/write-audit-event.js");
vi.mock("../../grants/repositories/inbox.repository.js");
vi.mock("../../grants/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

// The session `withTransaction` would hand a real caller. Everything that has
// to join the transaction is asserted against this exact object.
const SESSION = { id: "the-transaction" };

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
});

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

    expect(redriveGasInbox).toHaveBeenCalledWith(ID, {
      by: undefined,
      session: SESSION,
    });
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
      statusLabel: "Resubmitted",
      attempts: "0/5",
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

    expect(redriveGasOutbox).toHaveBeenCalledWith(ID, {
      by: undefined,
      session: SESSION,
    });
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
      output: {
        payload: {
          statusCode: 409,
          status: "COMPLETED",
          statusLabel: "Completed",
        },
      },
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
      statusLabel: "Resubmitted",
      attempts: "0/7",
    });
  });

  it("passes a caseworking 409 through, with the words its status is spelled in", async () => {
    redriveCwEvent.mockRejectedValue(
      Object.assign(new Error("nope"), {
        output: { statusCode: 409, payload: { status: "COMPLETED" } },
      }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: {
        statusCode: 409,
        payload: { status: "COMPLETED", statusLabel: "Completed" },
      },
    });
  });

  it("keeps an unrecognised caseworking status in its own spelling", async () => {
    redriveCwEvent.mockRejectedValue(
      Object.assign(new Error("nope"), {
        output: { statusCode: 409, payload: { status: "QUARANTINED" } },
      }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { payload: { statusLabel: "QUARANTINED" } },
    });
  });

  // Nothing to spell: a 404 names no status, so nothing is added to it.
  it("passes a caseworking 404 through untouched", async () => {
    redriveCwEvent.mockRejectedValue(
      Object.assign(new Error("gone"), { output: { statusCode: 404 } }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    await expect(call({ service: "caseworking" })).rejects.not.toHaveProperty(
      "output.payload.statusLabel",
    );
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
      SESSION,
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

    expect(redriveGasInbox).toHaveBeenCalledWith(ID, {
      by: "donatas",
      session: SESSION,
    });
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
      SESSION,
    );
  });
});

// The mechanism the reviewer asked for: a GAS redrive and its audit event
// commit together or not at all.
describe("redriveEventUseCase transaction", () => {
  it("runs the GAS redrive and its audit inside one transaction", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());

    await call();

    expect(withTransaction).toHaveBeenCalledTimes(1);
    // The same session reaches the row update and the audit's outbox insert -
    // which is what makes them one commit.
    expect(redriveGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ session: SESSION }),
    );
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      SESSION,
    );
  });

  // A swallowed audit failure would leave the row redriven with no record of
  // it. Rethrowing aborts the transaction instead: nothing happened.
  it("fails the redrive when the audit event cannot be written", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call()).rejects.toThrow("outbox insert failed");
  });

  // The abort is the transaction's job, so what this asserts is that the error
  // escapes `withTransaction`'s callback - the only way a real transaction
  // would ever roll the row back.
  it("lets the audit failure escape the transaction callback", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    let escaped = null;
    withTransaction.mockImplementation(async (callback) => {
      try {
        return await callback(SESSION);
      } catch (error) {
        escaped = error;
        throw error;
      }
    });

    await expect(call()).rejects.toThrow("outbox insert failed");
    expect(escaped).toBeInstanceOf(Error);
  });

  // An invalid audit payload is the same hole a failed insert was, one layer
  // up: the audit is skipped, and inside a transaction the row would otherwise
  // commit with nothing recording it.
  it("fails the redrive when the audit payload will not validate", async () => {
    redriveGasInbox.mockResolvedValue(aRedrivenGasInboxDoc());
    writeAuditEvent.mockRejectedValue(
      new Error("Audit event failed validation"),
    );

    await expect(call()).rejects.toThrow("Audit event failed validation");
  });

  // The conflict read runs inside the transaction too, so it cannot disagree
  // with the update that just failed to match about what the row is.
  it("reads the blocking status inside the transaction", async () => {
    redriveGasInbox.mockResolvedValue(null);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await call().catch(() => {});

    expect(gasInboxStatus).toHaveBeenCalledWith(ID, SESSION);
  });

  // Caseworking's redrive is an HTTP call to another service and no Mongo
  // transaction can span it, so that branch stays best-effort: a failed audit
  // is logged and the redrive stands. Pinned so the distinction is deliberate
  // rather than accidental.
  it("opens no transaction for a Caseworking redrive", async () => {
    redriveCwEvent.mockResolvedValue(aCwRow());

    await call({ service: "caseworking" });

    expect(withTransaction).not.toHaveBeenCalled();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      undefined,
    );
  });

  it("keeps a Caseworking redrive when its audit event cannot be written", async () => {
    redriveCwEvent.mockResolvedValue(aCwRow());
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    const result = await call({ service: "caseworking" });

    expect(result.event.service).toBe("caseworking");
  });
});
