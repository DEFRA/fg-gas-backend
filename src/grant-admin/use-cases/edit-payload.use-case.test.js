import { Decimal128, Long } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { payloadHash } from "../../events/payload-changes.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  editPayloadById as editGasInbox,
  findEditableById as findEditableGasInbox,
  findStatusById as gasInboxStatus,
} from "../../events/repositories/inbox.repository.js";
import {
  editPayloadById as editGasOutbox,
  findEditableById as findEditableGasOutbox,
} from "../../events/repositories/outbox.repository.js";
import { editCwPayload } from "../repositories/cw-actuators.repository.js";
import { editPayloadUseCase } from "./edit-payload.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../events/repositories/inbox.repository.js");
vi.mock("../../events/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";

const SESSION = { id: "the-transaction" };

const STORED_EVENT = {
  id: "evt-1",
  data: { email: "old@example.com", sheetId: 679 },
};

const EDITED_EVENT = {
  id: "evt-1",
  data: { email: "new@example.com", sheetId: "SX0679" },
};

const NOTE = "sheetId was sent as a number by Ł. Kowalski";

const aStoredRow = (overrides = {}) => ({
  status: "DEAD_LETTER",
  event: STORED_EVENT,
  ...overrides,
});

const CW_RESULT = {
  payloadRevision: 4,
  changedPaths: ["/data/sheetId"],
  changedPathsTruncated: false,
};

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
});

const call = (overrides = {}) =>
  editPayloadUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    caller: "admin-ui",
    actor: "donatas",
    payload: EDITED_EVENT,
    note: NOTE,
    revision: 0,
    ...overrides,
  });

const reasonOf = (promise) =>
  promise.catch((error) => [
    error.output.statusCode,
    error.output.payload.reason,
  ]);

describe("editPayloadUseCase gas", () => {
  it("reads the row and writes the edit fenced on the revision it was made from", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());
    editGasInbox.mockResolvedValue(true);

    await call();

    expect(findEditableGasInbox).toHaveBeenCalledWith(ID, SESSION);
    expect(editGasInbox).toHaveBeenCalledWith(ID, {
      revision: 0,
      event: EDITED_EVENT,
      original: STORED_EVENT,
      by: "donatas",
      note: NOTE,
      session: SESSION,
    });
    expect(editCwPayload).not.toHaveBeenCalled();
  });

  it("keeps no original once the row has been edited", async () => {
    findEditableGasInbox.mockResolvedValue(
      aStoredRow({
        payloadRevision: 2,
        lastEdit: { at: "t", by: "a", note: "n" },
      }),
    );
    editGasInbox.mockResolvedValue(true);

    await call({ revision: 2 });

    expect(editGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ original: undefined }),
    );
  });

  // A purge or a redrive moves the revision on without an edit.
  it("keeps the original on a first edit past revision 0", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow({ payloadRevision: 1 }));
    editGasInbox.mockResolvedValue(true);

    await call({ revision: 1 });

    expect(editGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ original: STORED_EVENT }),
    );
  });

  it("answers with the new revision and the changed paths", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow({ payloadRevision: 2 }));
    editGasInbox.mockResolvedValue(true);

    expect(await call({ revision: 2 })).toEqual({
      payloadRevision: 3,
      changedPaths: ["/data/email", "/data/sheetId"],
      changedPathsTruncated: false,
      beforeHash: payloadHash(STORED_EVENT),
      afterHash: payloadHash(EDITED_EVENT),
    });
  });

  it("saves BSON numbers sent back untouched as their JSON text, as a Date is", async () => {
    const stored = {
      id: "evt-1",
      data: {
        big: Long.fromString("9007199254740993"),
        amount: Decimal128.fromString("1.10"),
      },
    };
    const untouched = {
      id: "evt-1",
      data: { big: "9007199254740993", amount: "1.10" },
    };
    findEditableGasInbox.mockResolvedValue(aStoredRow({ event: stored }));
    editGasInbox.mockResolvedValue(true);

    const result = await call({ payload: untouched });

    expect(result.changedPaths).toEqual(["/data/big", "/data/amount"]);
    expect(result.beforeHash).toBe(result.afterHash);
    expect(editGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ event: untouched, original: stored }),
    );
  });

  it("uses the outbox repository for box=outbox", async () => {
    findEditableGasOutbox.mockResolvedValue(aStoredRow({ status: "PURGED" }));
    editGasOutbox.mockResolvedValue(true);

    await call({ box: "outbox" });

    expect(editGasOutbox).toHaveBeenCalledTimes(1);
    expect(editGasInbox).not.toHaveBeenCalled();
  });

  it("404s when there is no such row", async () => {
    findEditableGasInbox.mockResolvedValue(null);

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(editGasInbox).not.toHaveBeenCalled();
  });

  it("409s with the current status when the row cannot be edited", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow({ status: "COMPLETED" }));

    await expect(call()).rejects.toMatchObject({
      message: `gas inbox event "${ID}" is COMPLETED, not editable (DEAD_LETTER or PURGED)`,
      output: {
        payload: {
          statusCode: 409,
          status: "COMPLETED",
          statusLabel: "Completed",
        },
      },
    });
    expect(editGasInbox).not.toHaveBeenCalled();
  });

  it("412s when the row was edited since the revision given", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow({ payloadRevision: 1 }));

    await expect(call({ revision: 0 })).rejects.toMatchObject({
      output: { statusCode: 412 },
    });
    expect(editGasInbox).not.toHaveBeenCalled();
  });

  it("412s when a revision is given for a row never edited", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());

    await expect(call({ revision: 1 })).rejects.toMatchObject({
      output: { statusCode: 412 },
    });
  });

  it("refuses an unchanged payload as UNCHANGED", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());

    expect(await reasonOf(call({ payload: { ...STORED_EVENT } }))).toEqual([
      422,
      "UNCHANGED",
    ]);
    expect(editGasInbox).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_AN_OBJECT", [STORED_EVENT]],
    ["DOLLAR_KEY", { ...STORED_EVENT, data: { $set: 1 } }],
    ["TOO_LARGE", { ...STORED_EVENT, blob: "x".repeat(300 * 1024) }],
  ])("refuses %s before writing", async (reason, payload) => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());

    expect(await reasonOf(call({ payload }))).toEqual([422, reason]);
    expect(editGasInbox).not.toHaveBeenCalled();
  });

  it.each([
    [null, 404],
    ["COMPLETED", 409],
    ["DEAD_LETTER", 412],
  ])(
    "reads the status when the fence refused, and a %s row is a %s",
    async (status, statusCode) => {
      findEditableGasInbox.mockResolvedValue(aStoredRow());
      editGasInbox.mockResolvedValue(false);
      gasInboxStatus.mockResolvedValue(status);

      await expect(call()).rejects.toMatchObject({ output: { statusCode } });
      expect(gasInboxStatus).toHaveBeenCalledWith(ID, SESSION);
    },
  );
});

describe("editPayloadUseCase caseworking", () => {
  it("proxies the edit to Caseworking with the operator", async () => {
    editCwPayload.mockResolvedValue(CW_RESULT);

    await call({ service: "caseworking", box: "outbox", revision: 3 });

    expect(editCwPayload).toHaveBeenCalledWith("outbox", ID, {
      by: "donatas",
      payload: EDITED_EVENT,
      note: NOTE,
      revision: 3,
    });
    expect(findEditableGasInbox).not.toHaveBeenCalled();
  });

  it("answers with what Caseworking changed", async () => {
    editCwPayload.mockResolvedValue(CW_RESULT);

    expect(await call({ service: "caseworking" })).toEqual(CW_RESULT);
  });

  it("gives a caseworking 409 the words its status is spelled in", async () => {
    editCwPayload.mockRejectedValue(
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

  it.each([404, 412, 422, 504])(
    "passes a caseworking %s through",
    async (statusCode) => {
      editCwPayload.mockRejectedValue(
        Object.assign(new Error("no"), { output: { statusCode, payload: {} } }),
      );

      await expect(call({ service: "caseworking" })).rejects.toMatchObject({
        output: { statusCode },
      });
    },
  );

  // An HTTP call no Mongo transaction can span.
  it("opens no transaction", async () => {
    editCwPayload.mockResolvedValue(CW_RESULT);

    await call({ service: "caseworking" });

    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe("editPayloadUseCase audit", () => {
  it("records who edited what, where and the hashes, in the transaction", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());
    editGasInbox.mockResolvedValue(true);

    await call();

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        entities: [
          {
            entity: auditEntities.EVENT,
            action: auditActions.EDIT_EVENT_PAYLOAD,
            entityid: ID,
          },
        ],
        details: {
          service: "gas",
          box: "inbox",
          caller: "admin-ui",
          actor: "donatas",
          revision: 0,
          changedPaths: ["/data/email", "/data/sheetId"],
          changedPathsTruncated: false,
          beforeHash: payloadHash(STORED_EVENT),
          afterHash: payloadHash(EDITED_EVENT),
        },
        segregationRef: `event-${ID}`,
      }),
      SESSION,
    );
  });

  it("keeps the note and every payload value off the audit event", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());
    editGasInbox.mockResolvedValue(true);

    await call();

    const audited = JSON.stringify(writeAuditEvent.mock.calls[0][0]);

    for (const value of ["Kowalski", "example.com", "SX0679", "evt-1"]) {
      expect(audited).not.toContain(value);
    }
  });

  it("records a Caseworking edit with the paths it answered with", async () => {
    editCwPayload.mockResolvedValue(CW_RESULT);

    await call({ service: "caseworking", revision: 3 });

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "SUCCESS",
        details: {
          service: "caseworking",
          box: "inbox",
          caller: "admin-ui",
          actor: "donatas",
          revision: 3,
          changedPaths: ["/data/sheetId"],
          changedPathsTruncated: false,
        },
      }),
      undefined,
    );
  });

  it("audits a refused edit as a FAILURE with no paths, and rethrows", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow({ payloadRevision: 5 }));

    await expect(call()).rejects.toMatchObject({
      output: { statusCode: 412 },
    });
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILURE",
        details: {
          service: "gas",
          box: "inbox",
          caller: "admin-ui",
          actor: "donatas",
          revision: 0,
          reason: "STALE",
        },
      }),
      null,
    );
  });

  it.each([
    ["NOT_FOUND", null],
    ["NOT_EDITABLE", aStoredRow({ status: "COMPLETED" })],
    ["UNCHANGED", aStoredRow({ event: EDITED_EVENT })],
  ])("names the reason %s on a FAILURE", async (reason, stored) => {
    findEditableGasInbox.mockResolvedValue(stored);

    await call().catch(() => {});

    expect(writeAuditEvent.mock.calls[0][0].details.reason).toBe(reason);
  });

  it("names no reason on a SUCCESS", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());
    editGasInbox.mockResolvedValue(true);

    await call();

    expect(writeAuditEvent.mock.calls[0][0].details).not.toHaveProperty(
      "reason",
    );
  });

  it.each([
    ["TOO_LARGE", 422, { reason: "TOO_LARGE" }],
    ["STALE", 412, {}],
    ["NOT_EDITABLE", 409, { status: "COMPLETED" }],
    [null, 504, {}],
  ])(
    "audits a refused Caseworking edit as a FAILURE with reason %s",
    async (reason, statusCode, payload) => {
      editCwPayload.mockRejectedValue(
        Object.assign(new Error("no"), { output: { statusCode, payload } }),
      );

      await call({ service: "caseworking" }).catch(() => {});

      expect(writeAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILURE",
          details: expect.objectContaining({ reason }),
        }),
        null,
      );
    },
  );

  it("fails the edit when its audit event cannot be written", async () => {
    findEditableGasInbox.mockResolvedValue(aStoredRow());
    editGasInbox.mockResolvedValue(true);
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call()).rejects.toThrow("outbox insert failed");
  });

  it("keeps a Caseworking edit when its audit event cannot be written", async () => {
    editCwPayload.mockResolvedValue(CW_RESULT);
    writeAuditEvent.mockRejectedValue(new Error("outbox insert failed"));

    await expect(call({ service: "caseworking" })).resolves.toEqual(CW_RESULT);
  });
});

describe("editPayloadUseCase logging", () => {
  it("logs neither the note nor any value from the payload", async () => {
    const info = vi.spyOn(logger, "info");
    const debug = vi.spyOn(logger, "debug");
    findEditableGasInbox.mockResolvedValue(aStoredRow());
    editGasInbox.mockResolvedValue(true);

    await call();

    const logged = JSON.stringify([info.mock.calls, debug.mock.calls]);

    expect(info).toHaveBeenCalledWith(
      `Edit event payload gas/inbox/${ID} at revision 0`,
    );
    for (const value of ["Kowalski", "example.com", "SX0679"]) {
      expect(logged).not.toContain(value);
    }
  });
});
