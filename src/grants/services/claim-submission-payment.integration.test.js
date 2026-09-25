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

const code = "woodland";
const clientRef = "CL-claim-submission";
const configVersion = "9.9.8";
const entitlementId = "entitlement-1";
const paymentDefinition = JSON.parse(
  readFileSync(
    new URL(
      "../../../compose/seed/woodland/1.28.2/gas/payment.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const payload = {
  metadata: {
    grantCode: code,
    clientRef,
    clientClaimRef: "claim-1",
    sbi: "106284736",
    frn: "1101234567",
  },
  claim: { entitlementId, totalClaimAmountPence: 4200 },
};

let replSet;
let mongoClient;
let db;
let submitClaim;
let dispatchEvent;
let clearPaymentDefinitionCaches;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "claim-submission-payment-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ submitClaim } = await import("./claims.service.js"));
  ({ dispatchEvent } = await import("../../events/index.js"));
  ({ clearPaymentDefinitionCaches } =
    await import("../../payments/use-cases/load-payment-definition.js"));
  const { save: saveApplication } =
    await import("../repositories/application.repository.js");
  const { save: saveGrant } =
    await import("../repositories/grant.repository.js");
  const { createTestApplication } =
    await import("../../../test/helpers/applications.js");
  const { createTestGrant } = await import("../../../test/helpers/grants.js");

  await mongoClient.connect();
  await saveGrant(
    createTestGrant({
      code,
      version: configVersion,
      entitlementTemplates: [
        {
          claimCode: "ENT_1",
          name: "Claimable entitlement",
          materialised: false,
          maxEntitlements: 1,
          fields: {
            area: {
              input: true,
              label: "Area",
              unitType: "decimal",
              decimalPlaces: 2,
              unit: "HA",
            },
          },
          availableAt: [
            {
              phase: "PRE_AWARD",
              stage: "ASSESSMENT",
              status: "APPLICATION_RECEIVED",
            },
          ],
          claim: {
            claimableAt: [
              {
                phase: "PRE_AWARD",
                stage: "ASSESSMENT",
                status: "APPLICATION_RECEIVED",
              },
            ],
            limits: { maximumClaims: 1 },
          },
        },
      ],
    }),
  );
  await db.collection("config_versions").insertOne({
    grantCode: code,
    version: configVersion,
    major: 9,
    minor: 9,
    patch: 8,
    status: "active",
    s3Bucket: "unused",
    s3Key: "woodland/gas.json",
    definitions: {
      grant: { s3Key: "woodland/gas.json", fetchStatus: "fetched" },
      payment: { s3Key: "woodland/payment.json", fetchStatus: "fetched" },
    },
  });
  await db.collection("payments__definitions").insertOne({
    code,
    version: configVersion,
    definition: paymentDefinition,
  });
  await saveApplication(
    createTestApplication({ code, clientRef, configVersion }),
  );
  await db.collection("entitlements").insertOne({
    id: entitlementId,
    code,
    clientRef,
    claimCode: "ENT_1",
    instanceNumber: 1,
  });
  await db.collection("agreements__agreements").insertOne({
    _id: "WM987654321",
    agreementNumber: "WM987654321",
    code,
    clientRef,
    version: 2,
    correlationId: "df170cc1-5653-4c36-a9cc-0faec3f34027",
    identifiers: {},
  });
}, 120_000);

beforeEach(async () => {
  clearPaymentDefinitionCaches();
  await Promise.all([
    db.collection("claims").deleteMany({}),
    db.collection("outbox").deleteMany({}),
    db.collection("payments__payments").deleteMany({}),
    db.collection("payments__counters").deleteMany({}),
    db
      .collection("payments__definitions")
      .updateOne(
        { code, version: configVersion },
        { $set: { definition: paymentDefinition } },
      ),
  ]);
});

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

describe("Claim submission and durable Payment request", () => {
  it("accepts an eligible Claim and publishes its pinned Payment request without creating a Payment", async () => {
    const result = await submitClaim({ code, clientRef, payload });

    expect(result).toEqual({ created: true, claimId: expect.any(String) });
    expect(result.claimId).toMatch(/^[a-f0-9]{24}$/);
    await expect(
      db.collection("outbox").findOne({ target: "internal:event-bus" }),
    ).resolves.toMatchObject({
      target: "internal:event-bus",
      event: {
        data: {
          requestId: `claim:${code}:${clientRef}:claim-1`,
          source: { code, clientRef, clientClaimRef: "claim-1", entitlementId },
          configVersion,
          agreement: {
            agreementNumber: "WM987654321",
            agreementVersion: 2,
            correlationId: "df170cc1-5653-4c36-a9cc-0faec3f34027",
          },
          snapshot: {
            sbi: "106284736",
            frn: "1101234567",
            totalAmountPence: 4200,
          },
        },
      },
    });
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);
  });

  it("replaying a Claim leaves one durable request and no synchronous Payment", async () => {
    const first = await submitClaim({ code, clientRef, payload });
    const replay = await submitClaim({ code, clientRef, payload });

    expect(first).toMatchObject({ created: true, claimId: expect.any(String) });
    expect(replay).toEqual({ created: false });
    await expect(db.collection("claims").countDocuments({})).resolves.toBe(1);
    await expect(
      db
        .collection("outbox")
        .countDocuments({ target: "internal:event-bus" }),
    ).resolves.toBe(1);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);
  });

  it("processes the durable request after Claim acceptance, producing a separate Payment", async () => {
    const accepted = await submitClaim({ code, clientRef, payload });
    const { payments } = await import("../../payments/index.js");
    const { OutboxSubscriber } =
      await import("../../events/subscribers/outbox.subscriber.js");
    await payments.register({});

    await new OutboxSubscriber().processWithLock("claim-delivery", clientRef);

    await expect(
      db.collection("outbox").findOne({ target: "internal:event-bus" }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(db.collection("claims").countDocuments({})).resolves.toBe(1);
    await expect(
      db.collection("payments__payments").findOne({}),
    ).resolves.toMatchObject({
      source: { type: "claim", code, clientRef, clientClaimRef: "claim-1" },
      paymentHubClaimId: "R00000001",
    });
    expect(accepted.claimId).toMatch(/^[a-f0-9]{24}$/);
    await expect(
      db
        .collection("outbox")
        .countDocuments({ "event.type": "io.onsite.agreement.create-payment" }),
    ).resolves.toBe(1);
  });

  it("does not request a Payment when its optional definition has no location", async () => {
    await db
      .collection("config_versions")
      .updateOne(
        { grantCode: code, version: configVersion },
        { $set: { "definitions.payment.s3Key": null } },
      );
    try {
      await expect(
        submitClaim({ code, clientRef, payload }),
      ).resolves.toMatchObject({
        created: true,
      });
      await expect(db.collection("claims").countDocuments({})).resolves.toBe(1);
      await expect(
        db
          .collection("outbox")
          .countDocuments({ target: "internal:event-bus" }),
      ).resolves.toBe(0);
    } finally {
      await db
        .collection("config_versions")
        .updateOne(
          { grantCode: code, version: configVersion },
          { $set: { "definitions.payment.s3Key": "woodland/payment.json" } },
        );
    }
  });

  it("rolls back the Claim when its durable request cannot be persisted", async () => {
    const outbox = db.collection("outbox");
    await outbox.createIndex(
      { "event.data.requestId": 1 },
      { unique: true, sparse: true, name: "test_request_identity" },
    );
    await outbox.insertOne({
      event: { data: { requestId: `claim:${code}:${clientRef}:claim-1` } },
      target: "internal:event-bus",
    });
    try {
      await expect(submitClaim({ code, clientRef, payload })).rejects.toThrow();
      await expect(db.collection("claims").countDocuments({})).resolves.toBe(0);
      await expect(outbox.countDocuments({})).resolves.toBe(1);
    } finally {
      await outbox.dropIndex("test_request_identity");
    }
  });

  it("commits the Claim even if subsequent Payment processing fails", async () => {
    const accepted = await submitClaim({ code, clientRef, payload });
    const request = await db
      .collection("outbox")
      .findOne({ target: "internal:event-bus" });
    const { payments } = await import("../../payments/index.js");
    await payments.register({});
    await db
      .collection("payments__definitions")
      .updateOne(
        { code, version: configVersion },
        { $set: { definition: { invalid: true } } },
      );

    await expect(
      dispatchEvent({ event: request.event, type: request.event.type }),
    ).rejects.toThrow();

    await expect(
      db.collection("claims").findOne({ _id: { $exists: true } }),
    ).resolves.toMatchObject({
      _id: expect.anything(),
      clientClaimRef: payload.metadata.clientClaimRef,
    });
    expect(accepted.claimId).toMatch(/^[a-f0-9]{24}$/);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);
  });
});
