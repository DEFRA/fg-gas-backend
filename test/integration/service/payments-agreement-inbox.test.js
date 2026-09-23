import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DATABASE = "fg-gas-backend-payments-agreement-inbox-test";
vi.stubEnv("MONGO_DATABASE", DATABASE);
vi.resetModules();

const { AgreementPaymentRequestedEvent } =
  await import("../../../src/agreements/events/agreement-payment-requested.event.js");
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
const GRANT_CODE = "pigs-might-fly";
const CONFIG_VERSION = "9.9.4";
const S3_KEY = `${GRANT_CODE}/payment-agreement-inbox/${CONFIG_VERSION}/gas/payment.json`;
const AGREEMENT_NUMBER = "PMF987654321";
const EXECUTED_AT = "2026-08-06T10:15:00.000Z";
const paymentDefinitionJson = readFileSync(
  new URL(
    "../../../compose/seed/pigs-might-fly/1.0.0/gas/payment.json",
    import.meta.url,
  ),
  "utf8",
);

const agreement = {
  identifiers: { sbi: "106284736", frn: "1101234567" },
  agreementNumber: AGREEMENT_NUMBER,
  version: 1,
  code: GRANT_CODE,
  configVersion: CONFIG_VERSION,
  correlationId: "d1499df2-faf8-4489-9e5e-e6a45fca3525",
  state: "accepted",
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
      totalAmountPence: 2000,
    },
    {
      id: "action:2",
      code: "berkshire",
      description: "Berkshire",
      totalAmountPence: 1800,
    },
  ],
  items: [{ id: "item:1", code: "pigArk", description: "Pig ark" }],
  totalAmountPence: 3800,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 3800,
        lineItems: [
          { actionId: "action:1", amountPence: 2000 },
          {
            itemId: "item:1",
            description: "Seasonal pig ark payment",
            amountPence: 1800,
          },
        ],
      },
    ],
  },
};

const expectedPayment = {
  sbi: "106284736",
  frn: "1101234567",
  originalInvoiceNumber: "",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 2000,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
        {
          schemeCode: "CMOR1",
          description: "Seasonal pig ark payment",
          amountPence: 1800,
          accountCode: "SOS710",
          fundCode: "DRD10",
          deliveryBody: "RP00",
          marketingYear: "2026",
        },
      ],
    },
  ],
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
      Body: paymentDefinitionJson,
      ContentType: "application/json",
    }),
  );
  await upsert(
    ConfigVersion.new({
      grantCode: GRANT_CODE,
      version: CONFIG_VERSION,
      status: "active",
      s3Key: `${GRANT_CODE}/payment-agreement-inbox/${CONFIG_VERSION}/gas/gas.json`,
      s3Bucket: BUCKET,
    }),
  );
  await updateDefinitionLocation({
    grantCode: GRANT_CODE,
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
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: S3_KEY }),
  );
  await db?.dropDatabase();
  await client?.close();
  await mongoClient.close();
  vi.unstubAllEnvs();
});

const insertRequest = async (snapshot = agreement) => {
  const event = new AgreementPaymentRequestedEvent({
    agreement: snapshot,
    executedAt: EXECUTED_AT,
  });
  const result = await inbox.insertOne({
    source: "GAS",
    type: event.type,
    event,
    messageId: event.id,
    segregationRef: event.messageGroupId,
  });

  return inbox.findOne({ _id: result.insertedId });
};

const handle = async (doc) => {
  await new InboxSubscriber().handleEvent(Inbox.fromDocument(doc));
  return inbox.findOne({ _id: doc._id });
};

describe("Payments Agreement request inbox flow", () => {
  it("creates the Payment and its Payment Service publication, and completes the Inbox request", async () => {
    const request = await insertRequest();

    const completed = await handle(request);

    expect(completed.status).toBe(InboxStatus.COMPLETED);
    await expect(paymentDocuments.countDocuments({})).resolves.toBe(1);
    await expect(paymentDocuments.findOne({})).resolves.toMatchObject({
      source: {
        type: "agreement",
        agreementNumber: AGREEMENT_NUMBER,
        version: 1,
      },
      paymentHubClaimId: "R00000001",
      invoiceNumber: "R00000001-V001QX",
      ...expectedPayment,
    });
    await expect(outbox.countDocuments({})).resolves.toBe(1);
    await expect(outbox.findOne({})).resolves.toMatchObject({
      target: config.sns.createPaymentTopicArn,
      segregationRef: AGREEMENT_NUMBER,
      event: {
        type: "io.onsite.agreement.create-payment",
        source: "urn:service:agreement",
        data: {
          claimId: "R00000001",
          grants: [{ agreementNumber: AGREEMENT_NUMBER }],
        },
      },
    });
  });

  it("does not create a second Payment or publication when the same request is redelivered", async () => {
    const request = await insertRequest();

    await handle(request);
    await handle(request);

    await expect(paymentDocuments.countDocuments({})).resolves.toBe(1);
    await expect(outbox.countDocuments({})).resolves.toBe(1);
    await expect(paymentDocuments.findOne({})).resolves.toMatchObject({
      paymentHubClaimId: "R00000001",
      source: {
        type: "agreement",
        agreementNumber: AGREEMENT_NUMBER,
        version: 1,
      },
    });
  });

  it("leaves the request retryable and the definition usable when one snapshot fails to map", async () => {
    const failedAgreementNumber = "PMF000000001";
    const failedRequest = await insertRequest({
      agreementNumber: failedAgreementNumber,
      version: 1,
      code: GRANT_CODE,
      configVersion: CONFIG_VERSION,
      correlationId: "fdd96bcf-b7dc-4a4c-ad1f-a1fb25e0f88d",
    });

    const failed = await handle(failedRequest);

    expect(failed.status).toBe(InboxStatus.FAILED);
    expect(failed.retryable).toBe(true);
    await expect(
      paymentDocuments.countDocuments({
        "source.agreementNumber": failedAgreementNumber,
      }),
    ).resolves.toBe(0);

    const validAgreementNumber = "PMF000000002";
    const validRequest = await insertRequest({
      ...agreement,
      agreementNumber: validAgreementNumber,
      correlationId: "f4eb813d-cf66-462c-8885-9317aa30504e",
    });

    const completed = await handle(validRequest);

    expect(completed.status).toBe(InboxStatus.COMPLETED);
    await expect(
      paymentDocuments.findOne({
        "source.agreementNumber": validAgreementNumber,
      }),
    ).resolves.toMatchObject({
      source: {
        type: "agreement",
        agreementNumber: validAgreementNumber,
        version: 1,
      },
      paymentHubClaimId: "R00000001",
    });
  });
});
