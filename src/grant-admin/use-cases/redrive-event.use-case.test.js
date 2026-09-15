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

const SESSION = { id: "the-transaction" };

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
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
    redriveGasInbox.mockResolvedValue(true);

    await call();

    expect(redriveGasInbox).toHaveBeenCalledWith(ID, {
      by: undefined,
      session: SESSION,
    });
    expect(redriveCwEvent).not.toHaveBeenCalled();
  });

  // The admin redirects after a redrive and reads the row again.
  it("answers with nothing once the row is redriven", async () => {
    redriveGasInbox.mockResolvedValue(true);

    expect(await call()).toBeUndefined();
  });

  it("uses the outbox repository for box=outbox", async () => {
    redriveGasOutbox.mockResolvedValue(true);

    await call({ box: "outbox" });

    expect(redriveGasOutbox).toHaveBeenCalledWith(ID, {
      by: undefined,
      session: SESSION,
    });
    expect(redriveGasInbox).not.toHaveBeenCalled();
  });

  it("does not read the status again on the happy path", async () => {
    redriveGasInbox.mockResolvedValue(true);

    await call();

    expect(gasInboxStatus).not.toHaveBeenCalled();
  });

  it("404s when the update matched nothing and the row is gone", async () => {
    redriveGasInbox.mockResolvedValue(false);
    gasInboxStatus.mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("409s with the current status when the row is no longer DEAD_LETTER", async () => {
    redriveGasInbox.mockResolvedValue(false);
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

  it("loses cleanly to a concurrent state change", async () => {
    redriveGasOutbox.mockResolvedValue(false);
    gasOutboxStatus.mockResolvedValue("PROCESSING");

    await expect(call({ box: "outbox" })).rejects.toMatchObject({
      output: { payload: { status: "PROCESSING" } },
    });
    expect(redriveGasOutbox).toHaveBeenCalledTimes(1);
  });
});

describe("redriveEventUseCase caseworking", () => {
  it("calls the caseworking actuator redrive endpoint", async () => {
    redriveCwEvent.mockResolvedValue(undefined);

    await call({ service: "caseworking" });

    expect(redriveCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: undefined,
    });
    expect(redriveGasInbox).not.toHaveBeenCalled();
  });

  it("answers with nothing once Caseworking has redriven the row", async () => {
    redriveCwEvent.mockResolvedValue(undefined);

    expect(await call({ service: "caseworking" })).toBeUndefined();
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
    redriveGasInbox.mockResolvedValue(true);

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
    redriveGasInbox.mockResolvedValue(false);
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
    redriveGasInbox.mockResolvedValue(true);

    await call({ actor: "donatas" });

    expect(redriveGasInbox).toHaveBeenCalledWith(ID, {
      by: "donatas",
      session: SESSION,
    });
  });

  it("forwards the actor to Caseworking", async () => {
    redriveCwEvent.mockResolvedValue(undefined);

    await call({ service: "caseworking", actor: "donatas" });

    expect(redriveCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: "donatas",
    });
  });

  it("records the actor alongside the caller in the audit event", async () => {
    redriveGasInbox.mockResolvedValue(true);

    await call({ caller: "admin-ui", actor: "donatas" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ actor: "donatas" }),
      }),
      SESSION,
    );
  });
});

describe("redriveEventUseCase transaction", () => {
  it("runs the GAS redrive and its audit inside one transaction", async () => {
    redriveGasInbox.mockResolvedValue(true);

    await call();

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(redriveGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ session: SESSION }),
    );
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      SESSION,
    );
  });

  it("fails the redrive when the audit event cannot be written", async () => {
    redriveGasInbox.mockResolvedValue(true);
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call()).rejects.toThrow("outbox insert failed");
  });

  it("lets the audit failure escape the transaction callback", async () => {
    redriveGasInbox.mockResolvedValue(true);
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

  it("fails the redrive when the audit payload will not validate", async () => {
    redriveGasInbox.mockResolvedValue(true);
    writeAuditEvent.mockRejectedValue(
      new Error("Audit event failed validation"),
    );

    await expect(call()).rejects.toThrow("Audit event failed validation");
  });

  it("reads the blocking status inside the transaction", async () => {
    redriveGasInbox.mockResolvedValue(false);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await call().catch(() => {});

    expect(gasInboxStatus).toHaveBeenCalledWith(ID, SESSION);
  });

  // A Caseworking redrive is an HTTP call no Mongo transaction can span.
  it("opens no transaction for a Caseworking redrive", async () => {
    redriveCwEvent.mockResolvedValue(undefined);

    await call({ service: "caseworking" });

    expect(withTransaction).not.toHaveBeenCalled();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      undefined,
    );
  });

  it("keeps a Caseworking redrive when its audit event cannot be written", async () => {
    redriveCwEvent.mockResolvedValue(undefined);
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call({ service: "caseworking" })).resolves.toBeUndefined();
  });
});
