import { MongoClient } from "mongodb";
import { env } from "node:process";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Its own database, so the running service's poller cannot claim the fixtures.
// The setup files have already loaded config, hence the module reset.
const DATABASE = "fg-gas-backend-config-inbox-test";
vi.stubEnv("MONGO_DATABASE", DATABASE);
vi.resetModules();

const { Inbox, InboxStatus } =
  await import("../../../src/grants/models/inbox.js");
const { InboxSubscriber } =
  await import("../../../src/grants/subscribers/inbox.subscriber.js");
const { saveConfigVersionInboxMessageUseCase } =
  await import("../../../src/grants/use-cases/save-config-version-inbox-message.use-case.js");
const { db: serviceDb } = await import("../../../src/common/mongo-client.js");

// The bucket the compose stack seeds, and a version whose definitions are already in it.
const BUCKET = "config-broker-local";
const GRANT = "pigs-might-fly";
const VERSION = "1.0.0";

// Shaped as SqsSubscriber hands them over: attributes from SNS, metadata from the SQS
// message itself. The real SQS hop is deliberately not driven here - the containerised
// GAS is subscribed to the same queue and would consume the message first.
const attributes = (overrides = {}) => ({
  grant: { StringValue: GRANT, DataType: "String" },
  version: { StringValue: VERSION, DataType: "String" },
  status: { StringValue: "active", DataType: "String" },
  path: { StringValue: BUCKET, DataType: "String" },
  ...overrides,
});

const metadata = (messageId) => ({
  messageId,
  sentTimeStamp: "1758106800000",
});

let client;
let db;
let inbox;
let configVersions;

beforeAll(async () => {
  expect(serviceDb.databaseName).toBe(DATABASE);
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db(DATABASE);
  inbox = db.collection("inbox");
  configVersions = db.collection("config_versions");
});

beforeEach(async () => {
  await inbox.deleteMany({});
  await configVersions.deleteMany({});
});

afterAll(async () => {
  await client?.close();
});

const saveEvent = (messageId, manifest, overrides) =>
  saveConfigVersionInboxMessageUseCase(
    manifest,
    attributes(overrides),
    metadata(messageId),
  );

const handleOne = async () => {
  const doc = await inbox.findOne({});

  await new InboxSubscriber().handleEvent(Inbox.fromDocument(doc));

  return inbox.findOne({ _id: doc._id });
};

describe("config broker inbox flow", () => {
  const manifest = [
    `${GRANT}/${VERSION}/gas/gas.json`,
    `${GRANT}/${VERSION}/metadata.json`,
  ];

  // Scenario 1: the event is written to the Inbox and is NOT applied.
  it("saves the broker message to the inbox without applying it", async () => {
    await saveEvent("msg-1", manifest);

    const doc = await inbox.findOne({});
    expect(doc).toMatchObject({
      source: "CB",
      type: "config-version.updated",
      messageId: "msg-1",
      status: InboxStatus.PUBLISHED,
      segregationRef: GRANT,
      eventTime: "2025-09-17T11:00:00.000Z",
    });
    expect(doc.event.data).toMatchObject({
      grantCode: GRANT,
      version: VERSION,
      status: "active",
      s3Bucket: BUCKET,
      manifest,
    });

    await expect(configVersions.countDocuments({})).resolves.toBe(0);
  });

  it("does not save the same broker message twice", async () => {
    await saveEvent("msg-1", manifest);
    await saveEvent("msg-1", manifest);

    await expect(inbox.countDocuments({})).resolves.toBe(1);
  });

  // Scenario 2: the worker picks it up, applies it, and completes the record.
  it("applies the config version when the inbox worker picks it up", async () => {
    await saveEvent("msg-2", manifest);

    const doc = await handleOne();

    expect(doc.status).toBe(InboxStatus.COMPLETED);
    await expect(
      configVersions.findOne({ grantCode: GRANT, version: VERSION }),
    ).resolves.toMatchObject({
      status: "active",
      s3Bucket: BUCKET,
      definitions: { grant: { s3Key: `${GRANT}/${VERSION}/gas/gas.json` } },
    });
  });

  // Scenario 3: an incompatible version is refused, recorded, and not retried.
  it("gives up on a manifest missing the grant definition and applies nothing", async () => {
    await saveEvent("msg-3", [`${GRANT}/${VERSION}/metadata.json`]);

    const doc = await handleOne();

    expect(doc.status).toBe(InboxStatus.DEAD_LETTER);
    expect(doc.retryable).toBe(false);
    expect(doc.lastError.message).toContain(
      "does not contain required config file",
    );
    await expect(configVersions.countDocuments({})).resolves.toBe(0);
  });

  it("gives up on a message with no bucket", async () => {
    await saveEvent("msg-4", manifest, { path: undefined });

    const doc = await handleOne();

    expect(doc.status).toBe(InboxStatus.DEAD_LETTER);
    expect(doc.lastError.message).toContain("has no bucket");
    await expect(configVersions.countDocuments({})).resolves.toBe(0);
  });
});
