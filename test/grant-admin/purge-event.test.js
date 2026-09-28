import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const UNKNOWN_ID = "665f1c2e9a1b2c3d4e5f6aaa";

// The container reads .env (retries = 5), not test/vitest.config.js.
const GAS_MAX_ATTEMPTS = 5;
// EVENT_RETENTION_DAYS is unset everywhere, so the default applies.
const RETENTION_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const A_MINUTE = 60_000;

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
    message: "PRE-PURGE-FAILURE",
    stack: null,
  }));

// This payload fails in the inbox handler, so a redriven row never completes
// and never gains a deletion date.
const aDeadInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: `msg-purge-${new ObjectId().toHexString()}`,
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: `PURGE-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  completionDate: null,
  expireAt: null,
  lastPurge: null,
  lastError: {
    name: "TypeError",
    message: "boom",
    at: "2026-06-16T10:05:00.000Z",
  },
  attemptHistory: pastAttempts(),
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: { id: "evt-purge-1", time: "2026-06-16T10:00:00.000Z", data: {} },
  ...overrides,
});

const aDeadOutboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  target:
    "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_new_case_fifo.fifo",
  segregationRef: `PURGE-${new ObjectId().toHexString()}`,
  status: "DEAD_LETTER",
  completionAttempts: GAS_MAX_ATTEMPTS,
  publicationDate: new Date("2026-06-16T10:00:00.000Z"),
  completionDate: null,
  expireAt: null,
  lastPurge: null,
  lastError: null,
  attemptHistory: pastAttempts(),
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  event: {
    id: `evt-purge-${new ObjectId().toHexString()}`,
    type: "cloud.defra.local.fg-gas-backend.case.create",
    time: "2026-06-16T10:00:00.000Z",
    data: { clientRef: "CLIENT-REF-PURGE" },
  },
  ...overrides,
});

// A purge names its operator, so every call here carries `x-actor`; the one
// test that leaves it out passes its own headers.
const purge = (
  service,
  box,
  id,
  payload = { reasonCode: "BROKEN_PAYLOAD" },
  headers = { "x-actor": "donatas" },
) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/purge`, {
    payload,
    headers,
  });

const redrive = (service, box, id) =>
  wreck.post(`/grant-admin/events/${service}/${box}/${id}/redrive`);

const detailOf = (service, box, id) =>
  wreck.get(`/grant-admin/events/${service}/${box}/${id}`);

const bodyOf = (error) => {
  const payload = error.data?.payload;

  return Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
};

const aboutDaysFromNow = (value, days) => {
  const expected = Date.now() + days * MS_PER_DAY;

  return Math.abs(new Date(value).getTime() - expected) < A_MINUTE;
};

describe("POST /grant-admin/events/{service}/{box}/{id}/purge", () => {
  describe("validation", () => {
    it("rejects an unknown service with 400", async () => {
      await expect(purge("payments", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });

    it("rejects an id that is not a 24-hex ObjectId with 400", async () => {
      await expect(purge("gas", "inbox", "nope")).rejects.toThrow(
        "Response Error: 400 Bad Request",
      );
    });

    it("rejects an unknown reason code with 400, before touching the row", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await expect(
        purge("gas", "inbox", doc._id.toHexString(), {
          reasonCode: "JUST_BECAUSE",
        }),
      ).rejects.toThrow("Response Error: 400 Bad Request");

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("DEAD_LETTER");
    });

    it("rejects OTHER with no note with 400", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await expect(
        purge("gas", "inbox", doc._id.toHexString(), { reasonCode: "OTHER" }),
      ).rejects.toThrow("Response Error: 400 Bad Request");
    });

    it("rejects OTHER with a null note with 400, a null note being none", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await expect(
        purge("gas", "inbox", doc._id.toHexString(), {
          reasonCode: "OTHER",
          note: null,
        }),
      ).rejects.toThrow("Response Error: 400 Bad Request");
    });

    // A purge is audited on both backends, and neither has anyone else to name.
    it("rejects a purge that names no operator with 400, before touching the row", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await expect(
        purge(
          "gas",
          "inbox",
          doc._id.toHexString(),
          { reasonCode: "BROKEN_PAYLOAD" },
          {},
        ),
      ).rejects.toThrow("Response Error: 400 Bad Request");

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("DEAD_LETTER");
    });

    it("rejects a note of 501 characters with 400", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await expect(
        purge("gas", "inbox", doc._id.toHexString(), {
          reasonCode: "OTHER",
          note: "n".repeat(501),
        }),
      ).rejects.toThrow("Response Error: 400 Bad Request");
    });

    it("takes a note of 500 characters", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { res } = await purge("gas", "inbox", doc._id.toHexString(), {
        reasonCode: "OTHER",
        note: "n".repeat(500),
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe("gas", () => {
    it("404s for an id that does not exist", async () => {
      await expect(purge("gas", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 404 Not Found",
      );
    });

    it("answers 204 with no body", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { res, payload } = await purge(
        "gas",
        "inbox",
        doc._id.toHexString(),
      );

      expect(res.statusCode).toBe(204);
      expect(payload.length ?? 0).toBe(0);
    });

    it.each([
      ["inbox", () => inbox, aDeadInboxDoc],
      ["outbox", () => outbox, aDeadOutboxDoc],
    ])(
      "leaves the %s row PURGED, with a deadline and a record of who and why",
      async (box, collectionOf, aDoc) => {
        const doc = aDoc();
        await collectionOf().insertOne(doc);

        await purge("gas", box, doc._id.toHexString(), {
          reasonCode: "SENT_IN_ERROR",
          note: "raised twice by the same caseworker",
        });

        const stored = await collectionOf().findOne({ _id: doc._id });

        expect(stored.status).toBe("PURGED");
        expect(stored.lastPurge).toEqual({
          at: expect.any(String),
          by: "donatas",
          reasonCode: "SENT_IN_ERROR",
          note: "raised twice by the same caseworker",
        });
        expect(stored.expireAt).toBeInstanceOf(Date);
        expect(aboutDaysFromNow(stored.expireAt, RETENTION_DAYS)).toBe(true);
      },
    );

    it("records the operator from the x-actor header", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await wreck.post(
        `/grant-admin/events/gas/inbox/${doc._id.toHexString()}/purge`,
        {
          payload: { reasonCode: "BROKEN_PAYLOAD" },
          headers: { "x-actor": "donatas" },
        },
      );

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastPurge.by).toBe("donatas");
    });

    it("stores a null note when none was given", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString());

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastPurge.note).toBeNull();
    });

    // A client that sends the key regardless means the same as one that omits it.
    it("stores a null note when the body sent one", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      const { res } = await purge("gas", "inbox", doc._id.toHexString(), {
        reasonCode: "BROKEN_PAYLOAD",
        note: null,
      });

      expect(res.statusCode).toBe(204);

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastPurge.note).toBeNull();
    });

    it("keeps the payload, the attempt history and the last error", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString());

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.event).toEqual(doc.event);
      expect(stored.attemptHistory).toHaveLength(GAS_MAX_ATTEMPTS);
      expect(stored.lastError).toEqual(doc.lastError);
      expect(stored.completionAttempts).toBe(GAS_MAX_ATTEMPTS);
    });

    it("409s with the current status when the row is not DEAD_LETTER", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      const error = await purge("gas", "inbox", doc._id.toHexString()).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(bodyOf(error).status).toBe("COMPLETED");
      expect(bodyOf(error).statusLabel).toBe("Completed");
    });

    it("leaves a non-DEAD_LETTER row untouched", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString()).catch(() => {});

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("COMPLETED");
      expect(stored.lastPurge).toBeNull();
      expect(stored.expireAt).toBeNull();
    });

    it("writes an audit outbox event recording who purged what and why", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString(), {
        reasonCode: "OTHER",
        note: "raised twice by the same caseworker",
      });

      // Scoped to this row: nothing clears the outbox between tests.
      const audit = await outbox.findOne({
        "event.audit.entities.action": "PURGE_EVENT",
        "event.audit.entities.entityid": doc._id.toHexString(),
      });

      expect(audit).not.toBeNull();
      expect(audit.event.audit.entities[0]).toMatchObject({
        entity: "EVENT",
        action: "PURGE_EVENT",
        entityid: doc._id.toHexString(),
      });
      expect(audit.event.audit.details).toMatchObject({
        service: "gas",
        box: "inbox",
        reasonCode: "OTHER",
      });
      expect(audit.event.audit.status).toBe("SUCCESS");

      // The note is free text that can name whoever the operator wrote about,
      // so it stays on the row alone.
      expect(JSON.stringify(audit.event.audit.details)).not.toContain(
        "caseworker",
      );

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.status).toBe("PURGED");
    });

    it("audits a refused purge as a FAILURE", async () => {
      const doc = aDeadInboxDoc({ status: "COMPLETED" });
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString()).catch(() => {});

      const audit = await outbox.findOne({
        "event.audit.entities.action": "PURGE_EVENT",
        "event.audit.entities.entityid": doc._id.toHexString(),
      });

      expect(audit.event.audit.status).toBe("FAILURE");
    });

    it("409s on a second purge of an already purged row", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString());

      const error = await purge("gas", "inbox", doc._id.toHexString()).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(bodyOf(error).status).toBe("PURGED");
      expect(bodyOf(error).statusLabel).toBe("Purged");
    });

    // Only the latest purge is kept; nothing records the earlier ones.
    it("replaces lastPurge when the row is purged again", async () => {
      const doc = aDeadInboxDoc();
      await inbox.insertOne(doc);

      await purge("gas", "inbox", doc._id.toHexString(), {
        reasonCode: "BROKEN_PAYLOAD",
        note: "the first reason",
      });

      await inbox.updateOne(
        { _id: doc._id },
        { $set: { status: "DEAD_LETTER", expireAt: null } },
      );

      await purge("gas", "inbox", doc._id.toHexString(), {
        reasonCode: "OTHER",
        note: "the second reason",
      });

      const stored = await inbox.findOne({ _id: doc._id });

      expect(stored.lastPurge.reasonCode).toBe("OTHER");
      expect(stored.lastPurge.note).toBe("the second reason");
      expect(JSON.stringify(stored.lastPurge)).not.toContain("the first");
    });
  });

  describe("caseworking", () => {
    it("calls the caseworking actuator purge endpoint with the body", async () => {
      await setCwStub({ outbox: { purge: true } });

      await purge("caseworking", "outbox", UNKNOWN_ID, {
        reasonCode: "OTHER",
        note: "superseded",
      });

      const [request] = await cwStubRequests();

      expect(request.path).toBe(`/actuators/events/outbox/${UNKNOWN_ID}/purge`);
      expect(request.method).toBe("POST");
      expect(request.authorization).toBe("Bearer cw-stub-token");
      expect(request.body).toEqual({
        reasonCode: "OTHER",
        note: "superseded",
      });
    });

    it("leaves the note out of the body when there is none", async () => {
      await setCwStub({ inbox: { purge: true } });

      await purge("caseworking", "inbox", UNKNOWN_ID);

      const [request] = await cwStubRequests();

      expect(request.body).toEqual({ reasonCode: "BROKEN_PAYLOAD" });
    });

    // Caseworking stores null for an absent note, so a null one is left off
    // rather than forwarded.
    it("leaves the note out of the body when the body sent a null one", async () => {
      await setCwStub({ inbox: { purge: true } });

      await purge("caseworking", "inbox", UNKNOWN_ID, {
        reasonCode: "BROKEN_PAYLOAD",
        note: null,
      });

      const [request] = await cwStubRequests();

      expect(request.body).toEqual({ reasonCode: "BROKEN_PAYLOAD" });
      expect(request.body).not.toHaveProperty("note");
    });

    it("passes the operator on the way caseworking reads one", async () => {
      await setCwStub({ inbox: { purge: true } });

      await wreck.post(
        `/grant-admin/events/caseworking/inbox/${UNKNOWN_ID}/purge`,
        {
          payload: { reasonCode: "BROKEN_PAYLOAD" },
          headers: { "x-actor": "donatas" },
        },
      );

      const [request] = await cwStubRequests();

      expect(request.query.by).toBe("donatas");
    });

    it("answers 204 once Caseworking has purged the row", async () => {
      await setCwStub({ inbox: { purge: true } });

      const { res } = await purge("caseworking", "inbox", UNKNOWN_ID);

      expect(res.statusCode).toBe(204);
    });

    it("passes a caseworking 404 through as a 404", async () => {
      await expect(purge("caseworking", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 404 Not Found",
      );
    });

    it("passes a caseworking 409 through with the status in the body", async () => {
      await setCwStub({ inbox: { purgeConflictStatus: "COMPLETED" } });

      const error = await purge("caseworking", "inbox", UNKNOWN_ID).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(bodyOf(error).status).toBe("COMPLETED");
      expect(bodyOf(error).statusLabel).toBe("Completed");
    });

    // Caseworking may still commit after GAS gives up, so this is not a refusal.
    it(
      "504s when caseworking does not answer in time",
      { timeout: 15000 },
      async () => {
        await setCwStub({ inbox: { mode: "timeout" } });

        const error = await purge("caseworking", "inbox", UNKNOWN_ID).catch(
          (e) => e,
        );

        expect(error.output.statusCode).toBe(504);
      },
    );

    it("502s when caseworking is unavailable", async () => {
      await setCwStub({ inbox: { mode: "down" } });

      await expect(purge("caseworking", "inbox", UNKNOWN_ID)).rejects.toThrow(
        "Response Error: 502 Bad Gateway",
      );
    });
  });
});

describe("redriving a purged event", () => {
  it("takes a PURGED row, clears its deadline and keeps the purge record", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);

    await purge("gas", "inbox", doc._id.toHexString(), {
      reasonCode: "BROKEN_PAYLOAD",
      note: "worth one more try",
    });

    const purged = await inbox.findOne({ _id: doc._id });
    expect(purged.status).toBe("PURGED");

    const { res } = await redrive("gas", "inbox", doc._id.toHexString());

    expect(res.statusCode).toBe(204);

    // The poller may have claimed and failed it again; neither path writes a
    // deadline.
    const stored = await inbox.findOne({ _id: doc._id });

    expect(stored.status).not.toBe("PURGED");
    expect(stored.expireAt).toBeNull();
    expect(stored.lastPurge).toEqual(purged.lastPurge);
    expect(stored.lastRedrive).not.toBeNull();
  });

  it("409s on a row that is neither dead-lettered nor purged", async () => {
    const doc = aDeadInboxDoc({ status: "COMPLETED" });
    await inbox.insertOne(doc);

    const error = await redrive("gas", "inbox", doc._id.toHexString()).catch(
      (e) => e,
    );

    expect(error.output.statusCode).toBe(409);
    expect(bodyOf(error).message).toContain(
      "not redrivable (DEAD_LETTER or PURGED)",
    );
  });
});

describe("the event detail a purge is driven from", () => {
  it("projects a deletion date on a dead letter, so the admin offers the button", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);

    const { payload } = await detailOf("gas", "inbox", doc._id.toHexString());

    expect(aboutDaysFromNow(payload.purgeDeletionDate, RETENTION_DAYS)).toBe(
      true,
    );
    expect(payload.lastPurge).toBeNull();
    expect(payload.expiresAt).toBeNull();
  });

  it("names no projection once the row is purged, and the real date instead", async () => {
    const doc = aDeadOutboxDoc();
    await outbox.insertOne(doc);

    await purge("gas", "outbox", doc._id.toHexString(), {
      reasonCode: "OTHER",
      note: "no longer wanted",
    });

    const { payload } = await detailOf("gas", "outbox", doc._id.toHexString());

    expect(payload.status).toBe("PURGED");
    expect(payload.statusLabel).toBe("Purged");
    expect(payload.purgeDeletionDate).toBeNull();
    expect(aboutDaysFromNow(payload.expiresAt, RETENTION_DAYS)).toBe(true);
    expect(payload.lastPurge).toEqual({
      at: expect.any(String),
      by: "donatas",
      reasonCode: "OTHER",
      note: "no longer wanted",
    });
  });

  // Response validation fails closed, so an unnamed key would 500 this page.
  it("validates against the detail schema with both purge fields", async () => {
    const doc = aDeadInboxDoc();
    await inbox.insertOne(doc);

    await wreck.post(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}/purge`,
      {
        payload: { reasonCode: "BROKEN_PAYLOAD", note: "broken beyond repair" },
        headers: { "x-actor": "donatas" },
      },
    );

    const { res, payload } = await detailOf(
      "gas",
      "inbox",
      doc._id.toHexString(),
    );

    expect(res.statusCode).toBe(200);
    expect(payload.lastPurge.by).toBe("donatas");
    expect(payload).toHaveProperty("purgeDeletionDate");
  });
});
