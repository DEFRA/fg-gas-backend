import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { auditActions, auditStatus } from "../../events/audit-constants.js";
import {
  editPayloadById as editGasInbox,
  findEditableById as findEditableGasInbox,
  findStatusById as gasInboxStatus,
  redriveById as redriveGasInbox,
} from "../../events/repositories/inbox.repository.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  editCwPayload,
  redriveCwEvent,
} from "../repositories/cw-actuators.repository.js";
import { getEventUseCase } from "./get-event.use-case.js";
import { saveEventPayloadUseCase } from "./save-event-payload.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../events/repositories/inbox.repository.js");
vi.mock("../../events/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");
vi.mock("./get-event.use-case.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";
const SESSION = { id: "the-transaction" };

const STORED = {
  status: "DEAD_LETTER",
  event: { id: "evt-1", data: { a: 1 } },
};
const EDITED = { id: "evt-1", data: { a: 2 } };

const CW_SAVED = {
  payloadRevision: 4,
  changedPaths: ["/data/a"],
  changedPathsTruncated: false,
};

const EVENT = { id: ID, status: "DEAD_LETTER", payloadRevision: 3 };

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
});

const call = (overrides = {}) =>
  saveEventPayloadUseCase({
    service: "gas",
    box: "inbox",
    id: ID,
    caller: "grants-platform-admin",
    actor: "donatas",
    payload: EDITED,
    note: "fixed",
    revision: 0,
    redrive: false,
    ...overrides,
  });

const cwFailure = (statusCode, payload = {}) =>
  Object.assign(new Error("cw"), { output: { statusCode, payload } });

const actionsAudited = () =>
  writeAuditEvent.mock.calls.map(([event, session]) => [
    event.entities[0].action,
    event.status,
    session ?? null,
  ]);

describe("saveEventPayloadUseCase gas", () => {
  beforeEach(() => {
    findEditableGasInbox.mockResolvedValue(STORED);
    editGasInbox.mockResolvedValue(true);
  });

  it("saves alone, asking for no redrive", async () => {
    const saved = await call();

    expect(saved).toMatchObject({ payloadRevision: 1, redrive: null });
    expect(redriveGasInbox).not.toHaveBeenCalled();
  });

  it("saves and redrives in one transaction, both audits inside it", async () => {
    redriveGasInbox.mockResolvedValue(true);

    const saved = await call({ redrive: true });

    expect(saved.redrive).toEqual({ outcome: "redriven" });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(editGasInbox).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ session: SESSION }),
    );
    expect(redriveGasInbox).toHaveBeenCalledWith(ID, {
      by: "donatas",
      session: SESSION,
    });
    expect(actionsAudited()).toEqual([
      [auditActions.EDIT_EVENT_PAYLOAD, auditStatus.SUCCESS, SESSION],
      [auditActions.REDRIVE_EVENT, auditStatus.SUCCESS, SESSION],
    ]);
  });

  it("keeps the save when the redrive is refused, and names the status", async () => {
    redriveGasInbox.mockResolvedValue(false);
    gasInboxStatus.mockResolvedValue("COMPLETED");

    const saved = await call({ redrive: true });

    expect(saved).toMatchObject({
      payloadRevision: 1,
      redrive: {
        outcome: "conflict",
        status: "COMPLETED",
        statusLabel: "Completed",
      },
    });
  });

  it("aborts the save with the redrive when the redrive fails", async () => {
    redriveGasInbox.mockRejectedValue(new Error("write failed"));

    await expect(call({ redrive: true })).rejects.toThrow("write failed");
  });
});

describe("saveEventPayloadUseCase caseworking", () => {
  beforeEach(() => {
    editCwPayload.mockResolvedValue(CW_SAVED);
  });

  it("edits, then redrives as a second call, with no transaction", async () => {
    redriveCwEvent.mockResolvedValue(undefined);

    const saved = await call({ service: "caseworking", redrive: true });

    expect(saved).toEqual({ ...CW_SAVED, redrive: { outcome: "redriven" } });
    expect(redriveCwEvent).toHaveBeenCalledWith("inbox", ID, {
      by: "donatas",
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("answers a refused redrive as a conflict with its status", async () => {
    redriveCwEvent.mockRejectedValue(cwFailure(409, { status: "COMPLETED" }));

    expect(
      (await call({ service: "caseworking", redrive: true })).redrive,
    ).toEqual({
      outcome: "conflict",
      status: "COMPLETED",
      statusLabel: "Completed",
    });
  });

  it.each([404, 502, 503, 504])(
    "says the redrive failed on a %s, the save standing",
    async (statusCode) => {
      redriveCwEvent.mockRejectedValue(cwFailure(statusCode));

      expect(await call({ service: "caseworking", redrive: true })).toEqual({
        ...CW_SAVED,
        redrive: { outcome: "failed" },
      });
    },
  );
});

describe("saveEventPayloadUseCase stale", () => {
  it("answers a stale GAS save with the event as it is now", async () => {
    findEditableGasInbox.mockResolvedValue({ ...STORED, payloadRevision: 3 });
    gasInboxStatus.mockResolvedValue("DEAD_LETTER");
    getEventUseCase.mockResolvedValue(EVENT);

    const error = await call({ redrive: true }).catch((e) => e);

    expect(error.output.statusCode).toBe(412);
    expect(error.output.payload).toEqual({
      statusCode: 412,
      error: "Precondition Failed",
      message: "The payload was edited since the revision given",
      code: "STALE_REVISION",
      event: EVENT,
    });
    expect(getEventUseCase).toHaveBeenCalledWith({
      service: "gas",
      box: "inbox",
      id: ID,
      caller: "grants-platform-admin",
    });
    expect(redriveGasInbox).not.toHaveBeenCalled();
  });

  it("answers a stale Caseworking save the same way", async () => {
    editCwPayload.mockRejectedValue(Boom.preconditionFailed("stale"));
    getEventUseCase.mockResolvedValue(EVENT);

    const error = await call({ service: "caseworking" }).catch((e) => e);

    expect(error.output.payload).toMatchObject({
      code: "STALE_REVISION",
      event: EVENT,
    });
  });

  it("answers a null event when it cannot be read again", async () => {
    editCwPayload.mockRejectedValue(Boom.preconditionFailed("stale"));
    getEventUseCase.mockRejectedValue(Boom.notFound("gone"));

    const error = await call({ service: "caseworking" }).catch((e) => e);

    expect(error.output.payload).toMatchObject({
      statusCode: 412,
      code: "STALE_REVISION",
      event: null,
    });
  });

  it("passes any other refusal through untouched", async () => {
    editCwPayload.mockRejectedValue(Boom.conflict("no"));

    await expect(call({ service: "caseworking" })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(getEventUseCase).not.toHaveBeenCalled();
  });
});
