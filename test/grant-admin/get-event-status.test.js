import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cwStubRequestsBesideCatalogue,
  resetCwStub,
  setCwStub,
} from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

let client;
let inbox;
let outbox;

const UNKNOWN_ID = "665f1c2e9a1b2c3d4e5f6aaa";

// The container reads .env (5 retries), not test/vitest.config.js.
const GAS_MAX_ATTEMPTS = 5;

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

// COMPLETED with a far-future claim, so the running pollers leave it alone.
const anInboxDoc = (overrides = {}) => ({
  _id: new ObjectId(),
  messageId: "msg-status-1",
  type: "cloud.defra.local.fg-cw-backend.case.status.updated",
  source: "CW",
  segregationRef: "STATUS-SEG",
  status: "COMPLETED",
  completionAttempts: 2,
  eventTime: "2026-06-16T10:00:00.000Z",
  publicationDate: "2026-06-16T10:00:01.000Z",
  claimedBy: "SECRET-CLAIM-TOKEN",
  claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  event: { id: "evt-status-1", data: { clientRef: "SECRET-PAYLOAD" } },
  ...overrides,
});

const statusOf = async (service, box, id) =>
  (await wreck.get(`/grant-admin/events/${service}/${box}/${id}/status`))
    .payload;

const viewAudits = () =>
  outbox.countDocuments({ "event.audit.entities.action": "VIEW_EVENT" });

describe("GET /grant-admin/events/{service}/{box}/{id}/status", () => {
  it("answers a GAS row's status and its attempts since the last redrive, without its payload", async () => {
    const doc = anInboxDoc();
    await inbox.insertOne(doc);

    const { payload, res } = await wreck.get(
      `/grant-admin/events/gas/inbox/${doc._id.toHexString()}/status`,
    );

    expect(payload).toEqual({
      status: "COMPLETED",
      statusLabel: "Completed",
      attemptsSinceRedrive: 2,
      maxAttempts: GAS_MAX_ATTEMPTS,
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(payload)).not.toContain("SECRET");
  });

  it("answers a Caseworking row from Caseworking's status actuator", async () => {
    await setCwStub({
      outbox: {
        status: { status: "FAILED", completionAttempts: 3, maxAttempts: 7 },
      },
    });

    expect(await statusOf("caseworking", "outbox", UNKNOWN_ID)).toEqual({
      status: "FAILED",
      statusLabel: "Failed",
      attemptsSinceRedrive: 3,
      maxAttempts: 7,
    });

    const [request] = await cwStubRequestsBesideCatalogue();

    expect(request.path).toBe(`/actuators/events/outbox/${UNKNOWN_ID}/status`);
  });

  it("is a 404 for an event neither service has", async () => {
    await expect(statusOf("gas", "inbox", UNKNOWN_ID)).rejects.toThrow(
      "Response Error: 404 Not Found",
    );
    await expect(statusOf("caseworking", "inbox", UNKNOWN_ID)).rejects.toThrow(
      "Response Error: 404 Not Found",
    );
  });

  it("writes no audit event, as the detail read does", async () => {
    const doc = anInboxDoc();
    await inbox.insertOne(doc);
    await setCwStub({
      inbox: {
        status: { status: "COMPLETED", completionAttempts: 0, maxAttempts: 7 },
      },
    });

    await statusOf("gas", "inbox", doc._id.toHexString());
    await statusOf("caseworking", "inbox", UNKNOWN_ID);

    expect(await viewAudits()).toBe(0);
    expect(
      await outbox.countDocuments({ "event.audit": { $exists: true } }),
    ).toBe(0);
  });
});
