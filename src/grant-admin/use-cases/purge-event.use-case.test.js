import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  findStatusById as gasInboxStatus,
  purgeById as purgeGasInbox,
} from "../../events/repositories/inbox.repository.js";
import {
  findStatusById as gasOutboxStatus,
  purgeById as purgeGasOutbox,
} from "../../events/repositories/outbox.repository.js";
import { purgeCwEvent } from "../repositories/cw-actuators.repository.js";
import { purgeEventUseCase } from "./purge-event.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../events/repositories/inbox.repository.js");
vi.mock("../../events/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const SESSION = { id: "the-transaction" };

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
});

const call = (overrides = {}) =>
  purgeEventUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    caller: "grants-ui",
    actor: "donatas",
    reasonCode: "BROKEN_PAYLOAD",
    note: null,
    ...overrides,
  });

describe("purgeEventUseCase gas", () => {
  it("issues the conditional update against its own collection", async () => {
    purgeGasInbox.mockResolvedValue(true);

    await call({ actor: "donatas", note: "lost its clientRef" });

    expect(purgeGasInbox).toHaveBeenCalledWith(ID, {
      by: "donatas",
      reasonCode: "BROKEN_PAYLOAD",
      note: "lost its clientRef",
      session: SESSION,
    });
    expect(purgeCwEvent).not.toHaveBeenCalled();
  });

  it("answers with nothing once the row is purged", async () => {
    purgeGasInbox.mockResolvedValue(true);

    expect(await call()).toBeUndefined();
  });

  it("uses the outbox repository for box=outbox", async () => {
    purgeGasOutbox.mockResolvedValue(true);

    await call({ box: "outbox" });

    expect(purgeGasOutbox).toHaveBeenCalledTimes(1);
    expect(purgeGasInbox).not.toHaveBeenCalled();
  });

  it("does not read the status again on the happy path", async () => {
    purgeGasInbox.mockResolvedValue(true);

    await call();

    expect(gasInboxStatus).not.toHaveBeenCalled();
  });

  it("404s when the update matched nothing and the row is gone", async () => {
    purgeGasInbox.mockResolvedValue(false);
    gasInboxStatus.mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("409s with the current status when the row is no longer DEAD_LETTER", async () => {
    purgeGasInbox.mockResolvedValue(false);
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
    purgeGasOutbox.mockResolvedValue(false);
    gasOutboxStatus.mockResolvedValue("PURGED");

    await expect(call({ box: "outbox" })).rejects.toMatchObject({
      output: { payload: { status: "PURGED", statusLabel: "Purged" } },
    });
    expect(purgeGasOutbox).toHaveBeenCalledTimes(1);
  });
});

describe("purgeEventUseCase caseworking", () => {
  it("calls the caseworking actuator purge endpoint with the reason", async () => {
    purgeCwEvent.mockResolvedValue(undefined);

    await call({
      service: "caseworking",
      actor: "donatas",
      reasonCode: "OTHER",
      note: "superseded",
    });

    expect(purgeCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: "donatas",
      reasonCode: "OTHER",
      note: "superseded",
    });
    expect(purgeGasInbox).not.toHaveBeenCalled();
  });

  it("answers with nothing once Caseworking has purged the row", async () => {
    purgeCwEvent.mockResolvedValue(undefined);

    expect(await call({ service: "caseworking" })).toBeUndefined();
  });

  it("passes a caseworking 409 through, with the words its status is spelled in", async () => {
    purgeCwEvent.mockRejectedValue(
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
    purgeCwEvent.mockRejectedValue(
      Object.assign(new Error("nope"), {
        output: { statusCode: 409, payload: { status: "QUARANTINED" } },
      }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { payload: { statusLabel: "QUARANTINED" } },
    });
  });

  it("passes a caseworking 404 through untouched", async () => {
    purgeCwEvent.mockRejectedValue(
      Object.assign(new Error("gone"), { output: { statusCode: 404 } }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  // Caseworking may still have committed after GAS gave up, so a timeout is
  // not a refusal.
  it("passes a caseworking timeout through as a 504", async () => {
    purgeCwEvent.mockRejectedValue(
      Object.assign(new Error("slow"), { output: { statusCode: 504 } }),
    );

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { statusCode: 504 },
    });
  });
});

describe("purgeEventUseCase audit", () => {
  it("records who purged what, and why", async () => {
    purgeGasInbox.mockResolvedValue(true);

    await call({ caller: "admin-ui", actor: "donatas" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.PURGE_EVENT,
            entityid: ID,
          },
        ],
        details: {
          service: "gas",
          box: "inbox",
          caller: "admin-ui",
          actor: "donatas",
          reasonCode: "BROKEN_PAYLOAD",
        },
      }),
      SESSION,
    );
  });

  it("keys a Caseworking purge's audit event on the event id", async () => {
    purgeCwEvent.mockResolvedValue(undefined);

    await call({ service: "caseworking", box: "outbox", reasonCode: "OTHER" });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.PURGE_EVENT,
            entityid: ID,
          },
        ],
        segregationRef: `event-${ID}`,
      }),
      undefined,
    );
  });

  // Free text that can name whoever the operator wrote about. It stays on the
  // row, which is deleted on its retention date.
  it("keeps the note off the audit event", async () => {
    purgeGasInbox.mockResolvedValue(true);

    await call({ note: "raised twice by Ł. Kowalski" });

    expect(JSON.stringify(writeAuditEvent.mock.calls[0][0])).not.toContain(
      "Kowalski",
    );
  });

  it("audits a refused purge as a FAILURE and still rethrows", async () => {
    purgeGasInbox.mockResolvedValue(false);
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

describe("purgeEventUseCase transaction", () => {
  it("runs the GAS purge and its audit inside one transaction", async () => {
    purgeGasInbox.mockResolvedValue(true);

    await call();

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(purgeGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ session: SESSION }),
    );
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      SESSION,
    );
  });

  it("fails the purge when the audit event cannot be written", async () => {
    purgeGasInbox.mockResolvedValue(true);
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call()).rejects.toThrow("outbox insert failed");
  });

  it("lets the audit failure escape the transaction callback", async () => {
    purgeGasInbox.mockResolvedValue(true);
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

  it("reads the blocking status inside the transaction", async () => {
    purgeGasInbox.mockResolvedValue(false);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    await call().catch(() => {});

    expect(gasInboxStatus).toHaveBeenCalledWith(ID, SESSION);
  });

  // A Caseworking purge is an HTTP call no Mongo transaction can span.
  it("opens no transaction for a Caseworking purge", async () => {
    purgeCwEvent.mockResolvedValue(undefined);

    await call({ service: "caseworking" });

    expect(withTransaction).not.toHaveBeenCalled();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      undefined,
    );
  });

  it("keeps a Caseworking purge when its audit event cannot be written", async () => {
    purgeCwEvent.mockResolvedValue(undefined);
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call({ service: "caseworking" })).resolves.toBeUndefined();
  });
});
