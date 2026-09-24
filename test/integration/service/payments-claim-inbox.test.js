import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
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
import { deliverClaimPaymentRequest } from "../../helpers/deliver-claim-payment-request.js";

const DATABASE = "fg-gas-backend-payments-claim-inbox-test";
vi.stubEnv("MONGO_DATABASE", DATABASE);
vi.resetModules();

const { ClaimPaymentRequestedEvent } =
  await import("../../../src/grants/events/claim-payment-requested.event.js");
const { config } = await import("../../../src/common/config.js");
const { db: serviceDb, mongoClient } =
  await import("../../../src/common/mongo-client.js");
const { updateDefinitionLocation } =
  await import("../../../src/common/config-broker/config-catalog.repository.js");
const { Inbox, InboxStatus } =
  await import("../../../src/events/models/inbox.js");
const { clearEventHandlers } =
  await import("../../../src/events/services/event-handlers.js");
const { InboxSubscriber } =
  await import("../../../src/events/subscribers/inbox.subscriber.js");
const { ConfigVersion } =
  await import("../../../src/grants/models/config-version.js");
const { upsert } =
  await import("../../../src/grants/repositories/config-version.repository.js");
const { payments } = await import("../../../src/payments/index.js");

const BUCKET = "config-broker-local";
const CODE = "woodland";
const CONFIG_VERSION = "9.9.8";
const S3_KEY = `${CODE}/payment-claim-inbox/${CONFIG_VERSION}/gas/payment.json`;
const CLIENT_REF = "CL-claim-inbox-001";
const AGREEMENT_NUMBER = "WM987654321";
const EXECUTED_AT = "2026-08-06T10:15:00.000Z";
const definitionJson = readFileSync(
  new URL(
    "../../../compose/seed/woodland/1.28.2/gas/payment.json",
    import.meta.url,
  ),
  "utf8",
);

const request = {
  code: CODE,
  clientRef: CLIENT_REF,
  clientClaimRef: "claim-1",
  entitlementId: "entitlement-1",
  configVersion: CONFIG_VERSION,
  agreement: {
    agreementNumber: AGREEMENT_NUMBER,
    agreementVersion: 2,
    correlationId: "df170cc1-5653-4c36-a9cc-0faec3f34027",
  },
  executedAt: EXECUTED_AT,
  claim: { sbi: "106284736", frn: "1101234567", totalAmountPence: 4200 },
};

const s3Client = new S3Client({
  region: config.region,
  endpoint: config.awsEndpointUrl,
  forcePathStyle: true,
});

let client;
let db;
let inbox;
let paymentDocuments;
let outbox;

beforeAll(async () => {
  expect(serviceDb.databaseName).toBe(DATABASE);
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db(DATABASE);
  inbox = db.collection("inbox");
  paymentDocuments = db.collection("payments__payments");
  outbox = db.collection("outbox");

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: S3_KEY,
      Body: definitionJson,
      ContentType: "application/json",
    }),
  );
  await upsert(
    ConfigVersion.new({
      grantCode: CODE,
      version: CONFIG_VERSION,
      status: "active",
      s3Key: `${CODE}/payment-claim-inbox/${CONFIG_VERSION}/gas/gas.json`,
      s3Bucket: BUCKET,
    }),
  );
  await updateDefinitionLocation({
    grantCode: CODE,
    version: CONFIG_VERSION,
    definitionType: "payment",
    s3Key: S3_KEY,
  });
  await payments.register({});
});

beforeEach(async () => {
  await Promise.all([
    inbox.deleteMany({}),
    paymentDocuments.deleteMany({}),
    outbox.deleteMany({}),
    db.collection("payments__counters").deleteMany({}),
  ]);
});

afterAll(async () => {
  clearEventHandlers();
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: S3_KEY }));
  await db?.dropDatabase();
  await client?.close();
  await mongoClient.close();
  vi.unstubAllEnvs();
});

const deliver = (props = request) =>
  deliverClaimPaymentRequest({
    props,
    ClaimPaymentRequestedEvent,
    inbox,
    Inbox,
    InboxSubscriber,
  });

describe("Payments Claim request inbox flow", () => {
  it("creates a Payment and publication from the pinned Claim snapshot before completing the request", async () => {
    const completed = await deliver();

    expect(completed.status).toBe(InboxStatus.COMPLETED);
    await expect(paymentDocuments.countDocuments({})).resolves.toBe(1);
    await expect(paymentDocuments.findOne({})).resolves.toMatchObject({
      source: {
        type: "claim",
        code: CODE,
        clientRef: CLIENT_REF,
        clientClaimRef: "claim-1",
        entitlementId: "entitlement-1",
        agreementNumber: AGREEMENT_NUMBER,
        agreementVersion: 2,
      },
      correlationId: "df170cc1-5653-4c36-a9cc-0faec3f34027",
      paymentHubClaimId: "R00000001",
      invoiceNumber: "R00000001-V001QX",
      scheme: "WMP",
      totalAmountPence: 4200,
      marketingYear: "2026",
      payments: [{ dueDate: "2026-08-06", totalAmountPence: 4200 }],
    });
    await expect(outbox.countDocuments({})).resolves.toBe(1);
    await expect(outbox.findOne({})).resolves.toMatchObject({
      target: config.sns.createPaymentTopicArn,
      segregationRef: CLIENT_REF,
      event: {
        type: "io.onsite.agreement.create-payment",
        data: {
          claimId: "R00000001",
          grants: [{ agreementNumber: AGREEMENT_NUMBER }],
        },
      },
    });
  });

  it("does not create another Payment when the logical Claim request is redelivered", async () => {
    await deliver();
    const redelivered = await deliver({
      ...request,
      entitlementId: "entitlement-changed-since-submission",
      claim: { ...request.claim, totalAmountPence: 9000 },
    });

    expect(redelivered.status).toBe(InboxStatus.COMPLETED);
    await expect(paymentDocuments.countDocuments({})).resolves.toBe(1);
    await expect(outbox.countDocuments({})).resolves.toBe(1);
    await expect(paymentDocuments.findOne({})).resolves.toMatchObject({
      paymentHubClaimId: "R00000001",
      totalAmountPence: 4200,
      source: {
        clientClaimRef: "claim-1",
        entitlementId: "entitlement-1",
      },
    });
  });

  it("creates distinct Payments for different Claims under the same client reference", async () => {
    await deliver();
    const nextClaim = await deliver({ ...request, clientClaimRef: "claim-2" });

    expect(nextClaim.status).toBe(InboxStatus.COMPLETED);
    await expect(paymentDocuments.countDocuments({})).resolves.toBe(2);
    await expect(outbox.countDocuments({})).resolves.toBe(2);
    await expect(
      paymentDocuments.findOne({ "source.clientClaimRef": "claim-2" }),
    ).resolves.toMatchObject({ paymentHubClaimId: "R00000002" });
  });

  it("leaves a bad Claim snapshot retryable without poisoning its pinned definition", async () => {
    const failed = await deliver({
      ...request,
      clientClaimRef: "claim-invalid",
      claim: { frn: "1101234567", totalAmountPence: 4200 },
    });

    expect(failed.status).toBe(InboxStatus.FAILED);
    expect(failed.retryable).toBe(true);
    await expect(paymentDocuments.countDocuments({})).resolves.toBe(0);

    const completed = await deliver({
      ...request,
      clientClaimRef: "claim-valid",
    });
    expect(completed.status).toBe(InboxStatus.COMPLETED);
    await expect(paymentDocuments.findOne({})).resolves.toMatchObject({
      paymentHubClaimId: "R00000001",
      source: { clientClaimRef: "claim-valid" },
    });
  });
});
