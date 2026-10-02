import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { findById as findGasInboxById } from "../../events/repositories/inbox.repository.js";
import { findById as findGasOutboxById } from "../../events/repositories/outbox.repository.js";
import { applicationExists } from "../../grants/services/grant-admin.service.js";
import { findCwEvent } from "../repositories/cw-actuators.repository.js";
import { getEventAuditBuilder, getEventUseCase } from "./get-event.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../events/repositories/inbox.repository.js");
vi.mock("../../events/repositories/outbox.repository.js");
vi.mock("../repositories/cw-actuators.repository.js");
vi.mock("../../grants/services/grant-admin.service.js");

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
  publicationDate: "2026-06-16T10:00:00.000Z",
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

    const event = await call({ box: "outbox" });

    expect(findGasOutboxById).toHaveBeenCalledWith(ID);
    expect(event.box).toBe("outbox");
  });

  it("returns a normalised detail with the payload attached", async () => {
    findGasInboxById.mockResolvedValue(aGasInboxDoc());

    const event = await call();

    expect(event.service).toBe("gas");
    expect(event.id).toBe(ID);
    expect(event.payload).toEqual({
      id: "evt-1",
      data: { clientRef: "REF-1" },
    });
  });

  it("stamps GAS's own retry cap", async () => {
    findGasInboxById.mockResolvedValue(aGasInboxDoc());

    expect((await call()).attempts).toBe("5/5");
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

    expect((await call({ service: "caseworking" })).attempts).toBe("5/7");
  });

  it("returns the caseworking payload", async () => {
    findCwEvent.mockResolvedValue(aCwInboxDoc());

    const event = await call({ service: "caseworking" });

    expect(event.service).toBe("caseworking");
    expect(event.payload).toEqual({
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

describe("getEventUseCase record", () => {
  const withData = (data, overrides = {}) =>
    aGasInboxDoc({ event: { id: "evt-1", data }, ...overrides });

  it("links a GAS row to the application its refs name, once it exists", async () => {
    findGasInboxById.mockResolvedValue(
      withData({ clientRef: "ref-1", code: "frps-private-beta" }),
    );
    applicationExists.mockResolvedValue({ exists: true, identifiers: {} });

    const event = await call();

    expect(applicationExists).toHaveBeenCalledWith({
      clientRef: "ref-1",
      code: "frps-private-beta",
    });
    expect(event.record).toEqual({
      kind: "application",
      code: "frps-private-beta",
      ref: "ref-1",
    });
    expect(event.searchRef).toBe("GLD-9B2");
  });

  it("links a GAS-stored case status update to the application too", async () => {
    findGasInboxById.mockResolvedValue(
      withData({ caseRef: "ref-1", workflowCode: "frps-private-beta" }),
    );
    applicationExists.mockResolvedValue({ exists: true, identifiers: {} });

    const event = await call();

    expect(event.record).toEqual({
      kind: "application",
      code: "frps-private-beta",
      ref: "ref-1",
    });
  });

  it("gives no record, but still a searchRef, when the application is missing", async () => {
    findGasInboxById.mockResolvedValue(
      withData({ clientRef: "ref-1", code: "frps-private-beta" }),
    );
    applicationExists.mockResolvedValue({ exists: false, identifiers: null });

    const event = await call();

    expect(event.record).toBeNull();
    expect(event.searchRef).toBe("GLD-9B2");
  });

  it("shows the event with no record when the application cannot be checked", async () => {
    findGasInboxById.mockResolvedValue(
      withData({ clientRef: "ref-1", code: "frps-private-beta" }),
    );
    applicationExists.mockRejectedValue(new Error("mongo down"));

    const event = await call();

    expect(event.record).toBeNull();
    expect(event.searchRef).toBe("GLD-9B2");
  });

  it("checks nothing for a row with no refs", async () => {
    findGasInboxById.mockResolvedValue(withData({ grantCode: "woodland" }));

    const event = await call();

    expect(applicationExists).not.toHaveBeenCalled();
    expect(event.record).toBeNull();
  });

  it("gives an audit row neither a record nor a searchRef", async () => {
    findGasOutboxById.mockResolvedValue({
      _id: new ObjectId(ID),
      target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn",
      segregationRef: "admin-view-application",
      status: "COMPLETED",
      completionAttempts: 1,
      publicationDate: new Date("2026-06-16T10:00:00.000Z"),
      event: { audit: { entities: [] } },
    });

    const event = await call({ box: "outbox" });

    expect(applicationExists).not.toHaveBeenCalled();
    expect(event.record).toBeNull();
    expect(event.searchRef).toBeNull();
  });

  it("leaves a Caseworking row unlinked, with its searchRef", async () => {
    findCwEvent.mockResolvedValue(
      aCwInboxDoc({
        event: {
          id: "evt-1",
          data: { caseRef: "ref-1", workflowCode: "frps-private-beta" },
        },
      }),
    );

    const event = await call({ service: "caseworking" });

    expect(applicationExists).not.toHaveBeenCalled();
    expect(event.record).toBeNull();
    expect(event.searchRef).toBe("GLD-9B2");
  });

  it("links a Caseworking row to its case only when Caseworking says it exists", async () => {
    const withCase = (found) =>
      aCwInboxDoc({
        event: {
          id: "evt-1",
          data: { caseRef: "ref-1", workflowCode: "frps-private-beta" },
        },
        case: found,
      });

    findCwEvent.mockResolvedValueOnce(
      withCase({
        workflowCode: "frps-private-beta",
        caseRef: "ref-1",
        exists: true,
      }),
    );
    findCwEvent.mockResolvedValueOnce(
      withCase({
        workflowCode: "frps-private-beta",
        caseRef: "ref-1",
        exists: false,
      }),
    );
    findCwEvent.mockResolvedValueOnce(withCase(null));

    const linked = await call({ service: "caseworking" });
    const missing = await call({ service: "caseworking" });
    const unsaid = await call({ service: "caseworking" });

    expect(linked.record).toEqual({
      kind: "case",
      code: "frps-private-beta",
      ref: "ref-1",
    });
    expect(missing.record).toBeNull();
    expect(missing.searchRef).toBe("GLD-9B2");
    expect(unsaid.record).toBeNull();
    expect(linked).not.toHaveProperty("case");
  });

  it("carries PMC 0706 on the view audit", () => {
    const audit = getEventAuditBuilder([
      { service: "gas", box: "inbox", id: ID, caller: "grants-ui" },
    ]);

    expect(audit.security).toEqual({ pmccode: "0706" });
  });
});
