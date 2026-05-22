import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ConfigVersion,
  FetchStatus,
} from "../../../src/grants/models/config-version.js";
import { Inbox, InboxStatus } from "../../../src/grants/models/inbox.js";
import { claimEvents } from "../../../src/grants/repositories/inbox.repository.js";
import { InboxSubscriber } from "../../../src/grants/subscribers/inbox.subscriber.js";

let client;
let inboxCol, fifoCol, configVersionsCol;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db(env.MONGO_DATABASE);
  inboxCol = db.collection("inbox");
  fifoCol = db.collection("fifo_locks");
  configVersionsCol = db.collection("config_versions");
});

beforeEach(async () => {
  await inboxCol.deleteMany({});
  await fifoCol.deleteMany({});
  await configVersionsCol.deleteMany({});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await inboxCol.deleteMany({});
  await fifoCol.deleteMany({});
  await configVersionsCol.deleteMany({});
});

afterAll(async () => {
  await client?.close();
});

const createConfigBrokerInbox = (id, grantCode, version, status) => {
  return Inbox.createMock({
    _id: id,
    source: "CONFIG_BROKER",
    type: "config.version.published",
    messageId: `msg-${id}`,
    segregationRef: grantCode,
    event: {
      id: randomUUID(),
      type: "config.version.published",
      source: "config-broker",
      time: new Date().toISOString(),
      data: {
        grantCode,
        version,
        status,
      },
    },
  });
};

describe("config broker inbox flow", () => {
  it("should process a config broker message through the inbox and create a config_versions record", async () => {
    const inboxMsg = createConfigBrokerInbox(
      "cv-1",
      "woodland",
      "1.2.3",
      "active",
    );

    await inboxCol.insertOne(inboxMsg.toDocument());

    await fifoCol.insertOne({
      segregationRef: "woodland",
      locked: true,
      lockedAt: new Date(),
      actor: "INBOX",
    });

    const events = await claimEvents(randomUUID(), "woodland", 1);
    expect(events).toHaveLength(1);

    const subscriber = new InboxSubscriber();
    await subscriber.handleEvent(events[0]);

    const inboxDoc = await inboxCol.findOne({ _id: "cv-1" });
    expect(inboxDoc.status).toBe(InboxStatus.COMPLETED);

    const cvDoc = await configVersionsCol.findOne({
      grantCode: "woodland",
      version: "1.2.3",
    });
    expect(cvDoc).not.toBeNull();
    expect(cvDoc.major).toBe(1);
    expect(cvDoc.minor).toBe(2);
    expect(cvDoc.patch).toBe(3);
    expect(cvDoc.fetchStatus).toBe(FetchStatus.Pending);
    expect(cvDoc.s3Key).toBe("woodland/1.2.3/grant-definition.json");
  });

  it("should mark inbox event as failed when config version has invalid semver", async () => {
    const inboxMsg = createConfigBrokerInbox(
      "cv-2",
      "woodland",
      "not-a-version",
      "active",
    );

    await inboxCol.insertOne(inboxMsg.toDocument());

    await fifoCol.insertOne({
      segregationRef: "woodland",
      locked: true,
      lockedAt: new Date(),
      actor: "INBOX",
    });

    const events = await claimEvents(randomUUID(), "woodland", 1);
    const subscriber = new InboxSubscriber();
    await subscriber.handleEvent(events[0]);

    const inboxDoc = await inboxCol.findOne({ _id: "cv-2" });
    expect(inboxDoc.status).toBe(InboxStatus.FAILED);

    const cvCount = await configVersionsCol.countDocuments({
      grantCode: "woodland",
    });
    expect(cvCount).toBe(0);
  });

  it("should handle duplicate messages via upsert without error", async () => {
    const first = createConfigBrokerInbox(
      "cv-3",
      "woodland",
      "2.0.0",
      "active",
    );
    await inboxCol.insertOne(first.toDocument());
    await fifoCol.insertOne({
      segregationRef: "woodland",
      locked: true,
      lockedAt: new Date(),
      actor: "INBOX",
    });

    const events1 = await claimEvents(randomUUID(), "woodland", 1);
    const subscriber = new InboxSubscriber();
    await subscriber.handleEvent(events1[0]);

    const second = createConfigBrokerInbox(
      "cv-4",
      "woodland",
      "2.0.0",
      "active",
    );
    await inboxCol.insertOne(second.toDocument());
    await fifoCol.updateOne(
      { segregationRef: "woodland" },
      { $set: { locked: true, lockedAt: new Date() } },
    );

    const events2 = await claimEvents(randomUUID(), "woodland", 1);
    await subscriber.handleEvent(events2[0]);

    const cvCount = await configVersionsCol.countDocuments({
      grantCode: "woodland",
      version: "2.0.0",
    });
    expect(cvCount).toBe(1);

    const inboxDoc = await inboxCol.findOne({ _id: "cv-4" });
    expect(inboxDoc.status).toBe(InboxStatus.COMPLETED);
  });
});
