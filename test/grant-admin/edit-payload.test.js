import { Decimal128, Long, MongoClient, ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { env } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const UNKNOWN_ID = "665f1c2e9a1b2c3d4e5f6aaa";

// The container reads .env (retries = 5), not test/vitest.config.js.
const GAS_MAX_ATTEMPTS = 5;

const NOTE = "sheetId was sent as a number by the retired form";

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  inbox = client.db().collection("inbox");
  outbox = client.db().collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const pastAttempts = () =>
  Array.from({ length: GAS_MAX_ATTEMPTS }, (_, n) => ({
    at: `2026-06-16T10:0${n}:00.000Z`,
    name: "Error",
    message: "PRE-EDIT-FAILURE",
    stack: null,
  }));

const anInboxEvent = () => ({
  id: "evt-edit-1",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  time: "2026-06-16T10:00:00.000Z",
  data: { sheetId: 679, email: "applicant@example.com" },
});

// This payload fails in the inbox handler, so a redriven row never completes.
const aDeadInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: `msg-edit-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: `EDIT-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  completionDate: null,
  expireAt: null,
  lastError: {
    name: "TypeError",
    message: "boom",
    at: "2026-06-16T10:05:00.000Z",
  },
  attemptHistory: pastAttempts(),
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: anInboxEvent(),
  ...overrides,
});

const anOutboxEvent = () => ({
  id: `evt-edit-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-gas-backend.case.create",
  time: "2026-06-16T10:00:00.000Z",
  data: { clientRef: "CLIENT-REF-EDIT", sheetId: 679 },
});

const aDeadOutboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  segregationRef: `EDIT-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  completionDate: null,
  expireAt: null,
  lastError: null,
  attemptHistory: pastAttempts(),
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: anOutboxEvent(),
  ...overrides,
});

const withSheetId = (event, sheetId = "SX0679") => ({
  ...event,
  data: { ...event.data, sheetId },
});

const edit = (service, box, id, body, headers = { "x-actor": "donatas" }) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/payload`, {
    payload: body,
    headers,
  });

const anEdit = (payload, overrides = {}) => ({
  payload,
  note: NOTE,
  revision: 0,
  ...overrides,
});

const redrive = (service, box, id) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/redrive`);

const purge = (service, box, id) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/purge`, {
    payload: { reasonCode: "BROKEN_PAYLOAD" },
    headers: { "x-actor": "donatas" },
  });

const detailOf = (service, box, id) =>
  wreck.get(`/grant-admin/events/${service}/${box}/${id}`);

const bodyOf = (error) => {
  const payload = error.data?.payload;

  return Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
};

const failureOf = async (promise) => {
  const error = await promise.catch((e) => e);

  return { statusCode: error.output?.statusCode, body: bodyOf(error) };
};

const auditOf = (id) =>
  outbox.findOne({
    "event.audit.entities.action": "EDIT_EVENT_PAYLOAD",
    "event.audit.entities.entityid": id,
  });

const failureAuditOf = (id) =>
  outbox.findOne({
    "event.audit.entities.action": "EDIT_EVENT_PAYLOAD",
    "event.audit.entities.entityid": id,
    "event.audit.status": "FAILURE",
  });

const sha256 = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const waitFor = async (read, done, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;

  let value = await read();

  while (!done(value) && Date.now() < deadline) {
    await sleep(100);
    value = await read();
  }

  return value;
};

describe("POST /grant-admin/events/{service}/{box}/{id}/payload", () => {
  describe("validation", () => {
    it("rejects an unknown service with 400", async () => {
      const { statusCode } = await failureOf(
        edit("payments", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
      );

      expect(statusCode).toBe(400);
    });

    it("rejects an edit that names no operator with 400, before touching the row", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { statusCode } = await failureOf(
        edit(
          "gas",
          "inbox",
          doc._id.toHexString(),
          anEdit(withSheetId(doc.event)),
          {},
        ),
      );

      expect(statusCode).toBe(400);
      expect((await inbox.findOne({ _id: doc._id })).event).toEqual(doc.event);
    });

    it.each([
      ["no note", { note: undefined }],
      ["a whitespace note", { note: "   " }],
      ["a 501-character note", { note: "n".repeat(501) }],
      ["no revision", { revision: undefined }],
      ["a negative revision", { revision: -1 }],
      ["an array payload", { payload: [1, 2] }],
      ["a string payload", { payload: "text" }],
    ])("rejects %s with 400", async (_, overrides) => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { statusCode, body } = await failureOf(
        edit(
          "gas",
          "inbox",
          doc._id.toHexString(),
          anEdit(withSheetId(doc.event), overrides),
        ),
      );

      expect(statusCode).toBe(400);
      expect(JSON.stringify(body)).not.toContain("example.com");
      expect((await inbox.findOne({ _id: doc._id })).event).toEqual(doc.event);
    });

    it("refuses a __proto__ key with 400, as every route's JSON parser does", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const error = await wreck
        .post(
          `/grant-admin/events/gas/inbox/${doc._id.toHexString()}/payload`,
          {
            payload: `{"payload": {"__proto__": {"x": 1}}, "note": "n", "revision": 0}`,
            headers: {
              "x-actor": "donatas",
              "content-type": "application/json",
            },
          },
        )
        .catch((e) => e);

      expect(error.output.statusCode).toBe(400);
    });

    it("takes a 500-character note", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { res } = await edit(
        "gas",
        "inbox",
        doc._id.toHexString(),
        anEdit(withSheetId(doc.event), { note: "n".repeat(500) }),
      );

      expect(res.statusCode).toBe(200);
    });
  });

  describe("gas", () => {
    it.each([
      ["inbox", () => inbox, aDeadInboxDoc],
      ["outbox", () => outbox, aDeadOutboxDoc],
    ])(
      "saves the %s payload, keeps the original and the status, and answers with what changed",
      async (box, collectionOf, aDoc) => {
        const doc = aDoc();
        await collectionOf().insertOne(doc);
        const edited = withSheetId(doc.event);

        const { res, payload } = await edit(
          "gas",
          box,
          doc._id.toHexString(),
          anEdit(edited),
        );

        expect(res.statusCode).toBe(200);
        expect(payload).toEqual({
          payloadRevision: 1,
          changedPaths: ["/data/sheetId"],
          changedPathsTruncated: false,
        });

        const stored = await collectionOf().findOne({ _id: doc._id });

        expect(stored.status).toBe("DEAD_LETTER");
        expect(stored.event).toEqual(edited);
        expect(stored.originalPayload).toEqual(doc.event);
        expect(stored.payloadRevision).toBe(1);
        expect(stored.lastEdit).toEqual({
          at: expect.any(String),
          by: "donatas",
          note: NOTE,
        });
        expect(stored.attemptHistory).toHaveLength(GAS_MAX_ATTEMPTS);
        expect(stored.completionAttempts).toBe(GAS_MAX_ATTEMPTS);
        expect(stored.lastError).toEqual(doc.lastError);
      },
    );

    it("edits a PURGED row and leaves it purged", async () => {
      const doc = aDeadOutboxDoc({ status: "PURGED" });
      await outbox.insertOne(doc);

      await edit(
        "gas",
        "outbox",
        doc._id.toHexString(),
        anEdit(withSheetId(doc.event)),
      );

      expect((await outbox.findOne({ _id: doc._id })).status).toBe("PURGED");
    });

    // Nothing is locked: an audit record is edited like any other row.
    it("edits an audit row", async () => {
      const doc = aDeadOutboxDoc({
        target: env.GAS__SNS__AUDIT_TOPIC_ARN,
        event: { id: "audit-1", audit: { details: { a: 1 } } },
      });
      await outbox.insertOne(doc);

      const { payload } = await edit(
        "gas",
        "outbox",
        doc._id.toHexString(),
        anEdit({ id: "audit-1", audit: { details: { a: 2 } } }),
      );

      expect(payload.changedPaths).toEqual(["/audit/details/a"]);
    });

    it("keeps the first original through a second edit", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();

      await edit("gas", "inbox", id, anEdit(withSheetId(doc.event, "A")));
      const { payload } = await edit(
        "gas",
        "inbox",
        id,
        anEdit(withSheetId(doc.event, "B"), { revision: 1, note: "second" }),
      );

      expect(payload.payloadRevision).toBe(2);

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.originalPayload).toEqual(doc.event);
      expect(stored.event.data.sheetId).toBe("B");
      expect(stored.lastEdit.note).toBe("second");
    });

    // The poller claims by `eventTime`, so the columns follow the envelope.
    it("re-derives an inbox row's type and eventTime from the edited envelope", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await edit(
        "gas",
        "inbox",
        doc._id.toHexString(),
        anEdit({
          ...doc.event,
          type: "cloud.defra.local.fg-cw-backend.case.edited",
          time: "2026-06-15T09:00:00+01:00",
        }),
      );

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.type).toBe("cloud.defra.local.fg-cw-backend.case.edited");
      expect(stored.eventTime).toBe("2026-06-15T08:00:00.000Z");
    });

    it("404s for an id that does not exist", async () => {
      const { statusCode } = await failureOf(
        edit("gas", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
      );

      expect(statusCode).toBe(404);
    });

    it("409s with the current status, and leaves the row alone, when it cannot be edited", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      const { statusCode, body } = await failureOf(
        edit(
          "gas",
          "inbox",
          doc._id.toHexString(),
          anEdit(withSheetId(doc.event)),
        ),
      );

      expect(statusCode).toBe(409);
      expect(body.status).toBe("COMPLETED");
      expect(body.statusLabel).toBe("Completed");

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.event).toEqual(doc.event);
      expect(stored).not.toHaveProperty("lastEdit");
    });

    it("412s a stale editor and keeps the edit that got there first", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();

      await edit("gas", "inbox", id, anEdit(withSheetId(doc.event, "FIRST")));

      const { statusCode } = await failureOf(
        edit("gas", "inbox", id, anEdit(withSheetId(doc.event, "SECOND"))),
      );

      expect(statusCode).toBe(412);

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.event.data.sheetId).toBe("FIRST");
      expect(stored.payloadRevision).toBe(1);
    });

    it("412s an editor opened before a purge, and audits it as STALE", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();

      await edit("gas", "inbox", id, anEdit(withSheetId(doc.event, "FIRST")));
      const { payload: opened } = await detailOf("gas", "inbox", id);
      await purge("gas", "inbox", id);

      const { statusCode } = await failureOf(
        edit(
          "gas",
          "inbox",
          id,
          anEdit(withSheetId(doc.event, "SECOND"), {
            revision: opened.payloadRevision,
          }),
        ),
      );

      expect(statusCode).toBe(412);

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("PURGED");
      expect(stored.event.data.sheetId).toBe("FIRST");
      expect(stored.payloadRevision).toBe(opened.payloadRevision + 1);

      const audit = await failureAuditOf(id);

      expect(audit.event.audit.details).toMatchObject({
        revision: opened.payloadRevision,
        reason: "STALE",
      });
      expect(audit.event.audit.details).not.toHaveProperty("changedPaths");
    });

    // Should the row die again, an editor opened before the redrive is stale.
    it("moves the revision on when the row is redriven", async () => {
      const doc = aDeadOutboxDoc({ payloadRevision: 3 });
      await outbox.insertOne(doc);
      const id = doc._id.toHexString();

      await redrive("gas", "outbox", id);

      expect((await outbox.findOne({ _id: doc._id })).payloadRevision).toBe(4);
    });

    // The purge moved the revision on, but nobody had edited the row yet.
    it("keeps the original on the first edit of a purged row", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();

      await purge("gas", "inbox", id);
      const { payload: opened } = await detailOf("gas", "inbox", id);

      await edit(
        "gas",
        "inbox",
        id,
        anEdit(withSheetId(doc.event), { revision: opened.payloadRevision }),
      );

      const stored = await inbox.findOne({ _id: doc._id });

      expect(opened.payloadRevision).toBe(1);
      expect(stored.payloadRevision).toBe(2);
      expect(stored.originalPayload).toEqual(doc.event);
    });

    it.each([
      ["inbox", () => inbox, aDeadInboxDoc],
      ["outbox", () => outbox, aDeadOutboxDoc],
    ])(
      "edits a %s row stored with payloadRevision 0 at revision 0",
      async (box, collectionOf, aDoc) => {
        const doc = aDoc({ payloadRevision: 0 });
        await collectionOf().insertOne(doc);

        const { payload } = await edit(
          "gas",
          box,
          doc._id.toHexString(),
          anEdit(withSheetId(doc.event)),
        );

        expect(payload.payloadRevision).toBe(1);
        expect((await collectionOf().findOne({ _id: doc._id })).event).toEqual(
          withSheetId(doc.event),
        );
      },
    );

    it("412s a revision ahead of the row", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { statusCode } = await failureOf(
        edit(
          "gas",
          "inbox",
          doc._id.toHexString(),
          anEdit(withSheetId(doc.event), { revision: 3 }),
        ),
      );

      expect(statusCode).toBe(412);
    });

    it.each([
      ["UNCHANGED", (doc) => doc.event],
      ["DOLLAR_KEY", (doc) => ({ ...doc.event, data: { $set: { a: 1 } } })],
      ["TOO_LARGE", (doc) => ({ ...doc.event, blob: "x".repeat(256 * 1024) })],
    ])("refuses %s with 422 and the reason", async (reason, payloadOf) => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { statusCode, body } = await failureOf(
        edit("gas", "inbox", doc._id.toHexString(), anEdit(payloadOf(doc))),
      );

      expect(statusCode).toBe(422);
      expect(body.reason).toBe(reason);
      expect((await inbox.findOne({ _id: doc._id })).event).toEqual(doc.event);
    });

    it("answers 413 to a body far over the bound, before reading it", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { statusCode } = await failureOf(
        edit(
          "gas",
          "inbox",
          doc._id.toHexString(),
          anEdit({ ...doc.event, blob: "x".repeat(300 * 1024) }),
        ),
      );

      expect(statusCode).toBe(413);
    });

    it("writes an audit event naming the paths and hashes, never the values or the note", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();
      const edited = {
        ...doc.event,
        data: { sheetId: "SX0679", email: "someone-else@example.com" },
      };

      await edit("gas", "inbox", id, anEdit(edited));

      const audit = await auditOf(id);

      expect(audit.event.audit.status).toBe("SUCCESS");
      expect(audit.event.audit.entities[0]).toEqual({
        entity: "EVENT",
        action: "EDIT_EVENT_PAYLOAD",
        entityid: id,
      });
      expect(audit.event.audit.details).toMatchObject({
        service: "gas",
        box: "inbox",
        actor: "donatas",
        revision: 0,
        changedPaths: ["/data/sheetId", "/data/email"],
        changedPathsTruncated: false,
        beforeHash: sha256(doc.event),
        afterHash: sha256(edited),
      });

      const serialised = JSON.stringify(audit);

      for (const value of ["example.com", "SX0679", "retired form"]) {
        expect(serialised).not.toContain(value);
      }
    });

    it("audits a refused edit as a FAILURE with the reason and no paths", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();

      await edit("gas", "inbox", id, anEdit(withSheetId(doc.event))).catch(
        () => {},
      );

      const audit = await auditOf(id);

      expect(audit.event.audit.status).toBe("FAILURE");
      expect(audit.event.audit.details.reason).toBe("NOT_EDITABLE");
      expect(audit.event.audit.details).not.toHaveProperty("changedPaths");
      expect(JSON.stringify(audit)).not.toContain("retired form");
    });

    it("audits a 422 as a FAILURE with its refusal reason", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);
      const id = doc._id.toHexString();

      await edit("gas", "inbox", id, anEdit(doc.event)).catch(() => {});

      expect((await failureAuditOf(id)).event.audit.details.reason).toBe(
        "UNCHANGED",
      );
    });
  });

  describe("caseworking", () => {
    const CW_EDITED = {
      payloadRevision: 3,
      changedPaths: ["/data/sheetId"],
      changedPathsTruncated: false,
    };

    it("calls the caseworking actuator with the body and the operator", async () => {
      await setCwStub({ outbox: { edit: CW_EDITED } });
      const payload = withSheetId(anOutboxEvent());

      await edit(
        "caseworking",
        "outbox",
        UNKNOWN_ID,
        anEdit(payload, { revision: 2 }),
      );

      const [request] = await cwStubRequests();

      expect(request.method).toBe("POST");
      expect(request.path).toBe(
        `/actuators/events/outbox/${UNKNOWN_ID}/payload`,
      );
      expect(request.query.by).toBe("donatas");
      expect(request.authorization).toBe("Bearer cw-stub-token");
      expect(request.body).toEqual({ payload, note: NOTE, revision: 2 });
    });

    it("answers with what Caseworking changed", async () => {
      await setCwStub({ inbox: { edit: CW_EDITED } });

      const { res, payload } = await edit(
        "caseworking",
        "inbox",
        UNKNOWN_ID,
        anEdit(anInboxEvent()),
      );

      expect(res.statusCode).toBe(200);
      expect(payload).toEqual(CW_EDITED);
    });

    it("audits the request with the paths Caseworking answered with", async () => {
      await setCwStub({ inbox: { edit: CW_EDITED } });

      await edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent()));

      const audit = await auditOf(UNKNOWN_ID);

      expect(audit.event.audit.details).toMatchObject({
        service: "caseworking",
        box: "inbox",
        changedPaths: ["/data/sheetId"],
      });
      expect(JSON.stringify(audit)).not.toContain("retired form");
    });

    it("passes a caseworking 404 through", async () => {
      const { statusCode } = await failureOf(
        edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
      );

      expect(statusCode).toBe(404);
    });

    it("passes a caseworking 409 through with the status in the body", async () => {
      await setCwStub({ inbox: { editConflictStatus: "COMPLETED" } });

      const { statusCode, body } = await failureOf(
        edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
      );

      expect(statusCode).toBe(409);
      expect(body.status).toBe("COMPLETED");
      expect(body.statusLabel).toBe("Completed");
    });

    it("passes a caseworking 412 through, and audits it as STALE", async () => {
      await setCwStub({ inbox: { editStale: true } });

      const { statusCode } = await failureOf(
        edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
      );

      expect(statusCode).toBe(412);
      expect(
        (await failureAuditOf(UNKNOWN_ID)).event.audit.details,
      ).toMatchObject({ service: "caseworking", reason: "STALE" });
    });

    it.each(["TOO_LARGE", "UNCHANGED", "NOT_AN_OBJECT", "DOLLAR_KEY"])(
      "passes a caseworking 422 through with its %s reason",
      async (reason) => {
        await setCwStub({ inbox: { editRefusal: reason } });

        const { statusCode, body } = await failureOf(
          edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
        );

        expect(statusCode).toBe(422);
        expect(body.reason).toBe(reason);
      },
    );

    // Caseworking may still commit after GAS gives up, so this is not a refusal.
    it(
      "504s when caseworking does not answer in time",
      { timeout: 15000 },
      async () => {
        await setCwStub({ inbox: { mode: "timeout" } });

        const { statusCode } = await failureOf(
          edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
        );

        expect(statusCode).toBe(504);
      },
    );

    it("502s when caseworking is unavailable", async () => {
      await setCwStub({ inbox: { mode: "down" } });

      const { statusCode } = await failureOf(
        edit("caseworking", "inbox", UNKNOWN_ID, anEdit(anInboxEvent())),
      );

      expect(statusCode).toBe(502);
    });
  });
});

describe("an edited event after the pollers have had it", () => {
  const EDIT_FIELDS = ["payloadRevision", "lastEdit", "originalPayload"];

  const editFieldsOf = (row) =>
    Object.fromEntries(EDIT_FIELDS.map((field) => [field, row[field]]));

  // The inbox handler fails this payload, so the poller saves the row again
  // with the whole model.
  it("keeps the edit fields through an inbox poller save", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);
    const id = doc._id.toHexString();

    await edit("gas", "inbox", id, anEdit(withSheetId(doc.event)));
    await redrive("gas", "inbox", id);
    const edited = await inbox.findOne({ _id: doc._id });

    const processed = await waitFor(
      () => inbox.findOne({ _id: doc._id }),
      (row) => row.completionAttempts > 0,
    );

    expect(processed.completionAttempts).toBeGreaterThan(0);
    expect(editFieldsOf(processed)).toEqual(editFieldsOf(edited));
    expect(processed.event).toEqual(withSheetId(doc.event));
  });

  // Published or failed again, the poller has saved the row either way.
  it(
    "keeps the edit fields through an outbox poller save",
    { timeout: 15000 },
    async () => {
      const doc = aDeadOutboxDoc();
      await outbox.insertOne(doc);
      const id = doc._id.toHexString();

      await edit("gas", "outbox", id, anEdit(withSheetId(doc.event)));
      await redrive("gas", "outbox", id);
      const edited = await outbox.findOne({ _id: doc._id });

      const processed = await waitFor(
        () => outbox.findOne({ _id: doc._id }),
        (row) => row.status === "COMPLETED" || row.completionAttempts > 0,
        12000,
      );

      expect(
        processed.status === "COMPLETED" || processed.completionAttempts > 0,
      ).toBe(true);
      expect(editFieldsOf(processed)).toEqual(editFieldsOf(edited));
    },
  );
});

describe("the event detail an edit is driven from", () => {
  it("names revision 0, plain JSON and no edit on a row never edited", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);

    const { payload } = await detailOf("gas", "inbox", doc._id.toHexString());

    expect(payload.payloadRevision).toBe(0);
    expect(payload.payloadIsPlainJson).toBe(true);
    expect(payload.lastEdit).toBeNull();
    expect(payload.originalPayload).toBeNull();
  });

  it("shows the edit, the original and the new revision once edited", async () => {
    const doc = aDeadOutboxDoc();
    await outbox.insertOne(doc);
    const id = doc._id.toHexString();

    await edit("gas", "outbox", id, anEdit(withSheetId(doc.event)));

    const { res, payload } = await detailOf("gas", "outbox", id);

    expect(res.statusCode).toBe(200);
    expect(payload.payloadRevision).toBe(1);
    expect(payload.payload).toEqual(withSheetId(doc.event));
    expect(payload.originalPayload).toEqual(doc.event);
    expect(payload.lastEdit).toEqual({
      at: expect.any(String),
      by: "donatas",
      note: NOTE,
    });
  });

  it("flags a row holding a BSON Date as not plain JSON, and still edits it", async () => {
    const doc = aDeadOutboxDoc({
      event: {
        ...anOutboxEvent(),
        data: { submittedAt: new Date("2026-06-16T10:00:00.000Z") },
      },
    });
    await outbox.insertOne(doc);
    const id = doc._id.toHexString();

    const { payload } = await detailOf("gas", "outbox", id);

    expect(payload.payloadIsPlainJson).toBe(false);

    await edit(
      "gas",
      "outbox",
      id,
      anEdit({
        ...payload.payload,
        data: { submittedAt: "2026-06-16T10:00:00.000Z", note: "added" },
      }),
    );

    const stored = await outbox.findOne({ _id: doc._id });

    expect(stored.event.data.submittedAt).toBe("2026-06-16T10:00:00.000Z");
    expect(stored.originalPayload.data.submittedAt).toBeInstanceOf(Date);
  });

  it("serves BSON numbers as JSON text, and saves them back untouched as it", async () => {
    const doc = aDeadOutboxDoc({
      event: {
        ...anOutboxEvent(),
        data: {
          big: Long.fromString("9007199254740993"),
          amount: Decimal128.fromString("1.10"),
          sheetId: 679,
        },
      },
    });
    await outbox.insertOne(doc);
    const id = doc._id.toHexString();

    const { payload } = await detailOf("gas", "outbox", id);

    expect(payload.payloadIsPlainJson).toBe(false);
    expect(payload.payload.data).toEqual({
      big: "9007199254740993",
      amount: "1.10",
      sheetId: 679,
    });

    const { payload: saved } = await edit(
      "gas",
      "outbox",
      id,
      anEdit(payload.payload),
    );

    expect(saved.changedPaths).toEqual(["/data/big", "/data/amount"]);

    const stored = await outbox.findOne({ _id: doc._id });

    expect(stored.event.data).toEqual(payload.payload.data);
    expect(stored.originalPayload.data.big).toBeInstanceOf(Long);
    expect(stored.originalPayload.data.amount).toBeInstanceOf(Decimal128);

    const { details } = (await auditOf(id)).event.audit;

    expect(details.beforeHash).toBe(details.afterHash);

    const after = await detailOf("gas", "outbox", id);

    expect(after.payload.payloadIsPlainJson).toBe(true);
    expect(after.payload.originalPayload.data).toEqual(payload.payload.data);
  });

  it("serves a safe Long as a number, which an untouched save leaves UNCHANGED", async () => {
    const doc = aDeadOutboxDoc({
      event: { ...anOutboxEvent(), data: { sheetId: Long.fromNumber(679) } },
    });
    await outbox.insertOne(doc);
    const id = doc._id.toHexString();

    const { payload } = await detailOf("gas", "outbox", id);

    expect(payload.payloadIsPlainJson).toBe(true);
    expect(payload.payload.data).toEqual({ sheetId: 679 });

    const { statusCode, body } = await failureOf(
      edit("gas", "outbox", id, anEdit(payload.payload)),
    );

    expect(statusCode).toBe(422);
    expect(body.reason).toBe("UNCHANGED");
  });

  it("passes Caseworking's edit fields through, and reads their absence as null", async () => {
    const cwDoc = {
      messageId: "cw-msg-1",
      type: "cloud.defra.local.fg-cw-backend.case.status.updated",
      source: "CW",
      segregationRef: "CW-1",
      status: "DEAD_LETTER",
      completionAttempts: 5,
      maxAttempts: 5,
      publicationDate: "2026-06-16T10:00:01.000Z",
      eventTime: "2026-06-16T10:00:00.000Z",
      lastError: null,
      attemptHistory: [],
      event: anInboxEvent(),
    };

    await setCwStub({ inbox: { detail: cwDoc } });

    const before = await detailOf("caseworking", "inbox", UNKNOWN_ID);

    expect(before.payload.payloadRevision).toBeNull();
    expect(before.payload.payloadIsPlainJson).toBeNull();
    expect(before.payload.lastEdit).toBeNull();
    expect(before.payload.originalPayload).toBeNull();

    await setCwStub({
      inbox: {
        detail: {
          ...cwDoc,
          payloadRevision: 2,
          payloadIsPlainJson: false,
          lastEdit: {
            at: "2026-09-23T14:08:00.000Z",
            by: "donatas",
            note: "n",
          },
          originalPayload: { id: "evt-0" },
        },
      },
    });

    const after = await detailOf("caseworking", "inbox", UNKNOWN_ID);

    expect(after.payload.payloadRevision).toBe(2);
    expect(after.payload.payloadIsPlainJson).toBe(false);
    expect(after.payload.lastEdit).toEqual({
      at: "2026-09-23T14:08:00.000Z",
      by: "donatas",
      note: "n",
    });
    expect(after.payload.originalPayload).toEqual({ id: "evt-0" });
  });
});
