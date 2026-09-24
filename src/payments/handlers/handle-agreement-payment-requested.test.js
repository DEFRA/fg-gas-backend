import { Collection, MongoServerError } from "mongodb";
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

const agreement = {
  identifiers: { sbi: "106284736", frn: "1101234567" },
  agreementNumber: "PMF987654321",
  version: 1,
  code: "pigs-might-fly",
  configVersion: "9.9.4",
  correlationId: "d1499df2-faf8-4489-9e5e-e6a45fca3525",
  totalAmountPence: 2000,
  actions: [{ id: "action:1", description: "Large White Pig" }],
  paymentSchedule: {
    instalments: [
      {
        dueDate: "2026-11-06",
        totalAmountPence: 2000,
        lineItems: [{ actionId: "action:1", amountPence: 2000 }],
      },
    ],
  },
};

let replSet;
let mongoClient;
let db;
let Payment;
let AgreementPaymentRequestedEvent;
let handleAgreementPaymentRequested;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "agreement-payment-handler-unit-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ Payment } = await import("../models/payment.js"));
  ({ AgreementPaymentRequestedEvent } =
    await import("../../agreements/events/agreement-payment-requested.event.js"));
  ({ handleAgreementPaymentRequested } =
    await import("./handle-agreement-payment-requested.js"));

  await mongoClient.connect();
  await db.collection("config_versions").insertOne({
    grantCode: agreement.code,
    version: agreement.configVersion,
    s3Bucket: "unused",
    definitions: { payment: { s3Key: "unused", fetchStatus: "fetched" } },
  });
  await db.collection("payments__definitions").insertOne({
    code: agreement.code,
    version: agreement.configVersion,
    definition: JSON.parse(
      readFileSync(
        new URL(
          "../../../compose/seed/pigs-might-fly/1.0.0/gas/payment.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  });
  await db
    .collection("payments__payments")
    .createIndex(
      { "source.agreementNumber": 1, "source.version": 1 },
      { unique: true, partialFilterExpression: { "source.type": "agreement" } },
    );
}, 120_000);

beforeEach(async () => {
  await Promise.all([
    db.collection("payments__payments").deleteMany({}),
    db.collection("payments__counters").deleteMany({}),
    db.collection("outbox").deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

const request = () => ({
  event: new AgreementPaymentRequestedEvent({
    agreement,
    executedAt: "2026-08-06T10:15:00.000Z",
  }),
});

const assertOnePublication = async () => {
  await expect(
    db.collection("payments__payments").countDocuments({}),
  ).resolves.toBe(1);
  await expect(db.collection("outbox").countDocuments({})).resolves.toBe(1);
  await expect(
    db.collection("payments__counters").findOne({ _id: "claimIds" }),
  ).resolves.toMatchObject({ seq: 1 });
};

describe("Agreement payment request handler", () => {
  it("creates and returns the Payment with its durable publication", async () => {
    const payment = await handleAgreementPaymentRequested(request());

    expect(payment).toBeInstanceOf(Payment);
    expect(payment).toMatchObject({ paymentHubClaimId: "R00000001" });
    await assertOnePublication();
  });

  it("returns the same Payment for another delivery of the same source", async () => {
    const first = await handleAgreementPaymentRequested(request());
    const redelivered = await handleAgreementPaymentRequested(request());

    expect(redelivered).toBeInstanceOf(Payment);
    expect(redelivered.id).toBe(first.id);
    await assertOnePublication();
  });

  it("does not hide a duplicate-key error from another index", async () => {
    const insertOne = Collection.prototype.insertOne;
    const duplicate = new MongoServerError({
      code: 11000,
      keyPattern: { paymentHubClaimId: 1 },
      errmsg: "duplicate Payment Hub claim ID",
    });
    const insert = vi
      .spyOn(Collection.prototype, "insertOne")
      .mockImplementation(function (document, options) {
        if (this.collectionName === "payments__payments") {
          return Promise.reject(duplicate);
        }
        return insertOne.call(this, document, options);
      });

    try {
      await expect(handleAgreementPaymentRequested(request())).rejects.toBe(
        duplicate,
      );
    } finally {
      insert.mockRestore();
    }
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(0);
  });

  it("does not acknowledge a source duplicate without a committed winner", async () => {
    const insertOne = Collection.prototype.insertOne;
    const duplicate = new MongoServerError({
      code: 11000,
      keyPattern: { "source.agreementNumber": 1, "source.version": 1 },
      errmsg: "duplicate Agreement source",
    });
    const insert = vi
      .spyOn(Collection.prototype, "insertOne")
      .mockImplementation(function (document, options) {
        if (this.collectionName === "payments__payments") {
          return Promise.reject(duplicate);
        }
        return insertOne.call(this, document, options);
      });

    try {
      await expect(handleAgreementPaymentRequested(request())).rejects.toBe(
        duplicate,
      );
    } finally {
      insert.mockRestore();
    }
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(0);
  });

  it("recovers when the source unique index rejects an out-of-date lookup", async () => {
    const winner = await handleAgreementPaymentRequested(request());
    const findOne = Collection.prototype.findOne;
    let staleRead = true;
    const lookup = vi
      .spyOn(Collection.prototype, "findOne")
      .mockImplementation(function (filter, options) {
        if (this.collectionName === "payments__payments" && staleRead) {
          staleRead = false;
          return Promise.resolve(null);
        }
        return findOne.call(this, filter, options);
      });

    let recovered;
    try {
      recovered = await handleAgreementPaymentRequested(request());
    } finally {
      lookup.mockRestore();
    }

    expect(recovered).toBeInstanceOf(Payment);
    expect(recovered.id).toBe(winner.id);
    await assertOnePublication();
  });
});
