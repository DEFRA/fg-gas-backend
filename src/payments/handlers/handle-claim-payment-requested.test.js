import { MongoMemoryReplSet } from "mongodb-memory-server";
import { readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const request = {
  code: "woodland",
  clientRef: "CL-claim-handler-unit",
  clientClaimRef: "claim-1",
  entitlementId: "entitlement-1",
  configVersion: "9.9.8",
  agreement: {
    agreementNumber: "WM987654321",
    agreementVersion: 2,
    correlationId: "df170cc1-5653-4c36-a9cc-0faec3f34027",
  },
  executedAt: "2026-08-06T10:15:00.000Z",
  claim: { sbi: "106284736", frn: "1101234567", totalAmountPence: 4200 },
};

let replSet;
let mongoClient;
let db;
let ClaimPaymentRequestedEvent;
let Inbox;
let InboxStatus;
let InboxSubscriber;
let clearEventHandlers;
let payments;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "claim-payment-handler-unit-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ ClaimPaymentRequestedEvent } =
    await import("../../grants/events/claim-payment-requested.event.js"));
  ({ Inbox, InboxStatus } = await import("../../events/models/inbox.js"));
  ({ InboxSubscriber } =
    await import("../../events/subscribers/inbox.subscriber.js"));
  ({ clearEventHandlers } =
    await import("../../events/services/event-handlers.js"));
  ({ payments } = await import("../index.js"));

  await mongoClient.connect();
  await db.collection("config_versions").insertOne({
    grantCode: request.code,
    version: request.configVersion,
    s3Bucket: "unused",
    definitions: { payment: { s3Key: "unused", fetchStatus: "fetched" } },
  });
  await db.collection("payments__definitions").insertOne({
    code: request.code,
    version: request.configVersion,
    definition: JSON.parse(
      readFileSync(
        new URL(
          "../../../compose/seed/woodland/1.28.2/gas/payment.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  });
  await db.collection("payments__payments").createIndex(
    {
      "source.code": 1,
      "source.clientRef": 1,
      "source.clientClaimRef": 1,
    },
    { unique: true, partialFilterExpression: { "source.type": "claim" } },
  );
  payments.register({});
}, 120_000);

beforeEach(async () => {
  await Promise.all([
    db.collection("inbox").deleteMany({}),
    db.collection("payments__payments").deleteMany({}),
    db.collection("payments__counters").deleteMany({}),
    db.collection("outbox").deleteMany({}),
  ]);
});

afterAll(async () => {
  clearEventHandlers?.();
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

const deliver = async (props = request) => {
  const event = new ClaimPaymentRequestedEvent(props);
  const { insertedId } = await db.collection("inbox").insertOne({
    source: "GAS",
    type: event.type,
    event,
    messageId: event.id,
    segregationRef: event.messageGroupId,
  });
  const document = await db.collection("inbox").findOne({ _id: insertedId });
  await new InboxSubscriber().handleEvent(Inbox.fromDocument(document));
  return db.collection("inbox").findOne({ _id: insertedId });
};

describe("Claim payment request inbox flow", () => {
  it("completes the Inbox request only after creating its Payment and publication", async () => {
    const completed = await deliver();

    expect(completed.status).toBe(InboxStatus.COMPLETED);
    await expect(
      db.collection("payments__payments").findOne({}),
    ).resolves.toMatchObject({
      source: {
        type: "claim",
        code: "woodland",
        clientRef: "CL-claim-handler-unit",
        clientClaimRef: "claim-1",
        agreementNumber: "WM987654321",
      },
      paymentHubClaimId: "R00000001",
      totalAmountPence: 4200,
    });
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(1);
    await expect(db.collection("outbox").findOne({})).resolves.toMatchObject({
      event: {
        type: "io.onsite.agreement.create-payment",
        data: { claimId: "R00000001" },
      },
    });
  });

  it("reuses the first Payment on redelivery but creates one for a different Claim", async () => {
    await deliver();
    const repeated = await deliver({
      ...request,
      entitlementId: "changed-entitlement",
      claim: { ...request.claim, totalAmountPence: 9000 },
    });
    expect(repeated.status).toBe(InboxStatus.COMPLETED);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(1);
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(1);

    const next = await deliver({ ...request, clientClaimRef: "claim-2" });
    expect(next.status).toBe(InboxStatus.COMPLETED);
    await expect(
      db
        .collection("payments__payments")
        .findOne({ "source.clientClaimRef": "claim-2" }),
    ).resolves.toMatchObject({ paymentHubClaimId: "R00000002" });
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(2);
  });

  it("leaves an invalid snapshot retryable without spoiling the next request", async () => {
    const failed = await deliver({
      ...request,
      clientClaimRef: "bad-claim",
      claim: { frn: "1101234567", totalAmountPence: 4200 },
    });
    expect(failed.status).toBe(InboxStatus.FAILED);
    expect(failed.retryable).toBe(true);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);

    const valid = await deliver({ ...request, clientClaimRef: "good-claim" });
    expect(valid.status).toBe(InboxStatus.COMPLETED);
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(1);
  });
});
