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
let Payment;
let handleClaimPaymentRequested;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "claim-payment-handler-unit-test");
  vi.resetModules();

  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ ClaimPaymentRequestedEvent } =
    await import("../../grants/events/claim-payment-requested.event.js"));
  ({ Payment } = await import("../models/payment.js"));
  ({ handleClaimPaymentRequested } =
    await import("./handle-claim-payment-requested.js"));

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
    {
      unique: true,
      partialFilterExpression: { "source.type": "claim" },
      name: "claim_payment_source_unique",
    },
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

const handlerRequest = (props = request) => ({
  event: new ClaimPaymentRequestedEvent(props),
});

const assertOnePayment = async () => {
  await expect(
    db.collection("payments__payments").countDocuments({}),
  ).resolves.toBe(1);
  await expect(db.collection("outbox").countDocuments({})).resolves.toBe(1);
  await expect(
    db.collection("payments__counters").findOne({ _id: "claimIds" }),
  ).resolves.toMatchObject({ seq: 1 });
};

describe("Claim payment request handler", () => {
  it("creates a Payment and its durable publication", async () => {
    const payment = await handleClaimPaymentRequested(handlerRequest());

    expect(payment).toBeInstanceOf(Payment);
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
    const first = await handleClaimPaymentRequested(handlerRequest());
    const repeated = await handleClaimPaymentRequested(
      handlerRequest({
        ...request,
        entitlementId: "changed-entitlement",
        claim: { ...request.claim, totalAmountPence: 9000 },
      }),
    );
    expect(repeated.id).toBe(first.id);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(1);
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(1);

    const next = await handleClaimPaymentRequested(
      handlerRequest({
        ...request,
        clientClaimRef: "claim-2",
      }),
    );
    expect(next).toBeInstanceOf(Payment);
    await expect(
      db
        .collection("payments__payments")
        .findOne({ "source.clientClaimRef": "claim-2" }),
    ).resolves.toMatchObject({ paymentHubClaimId: "R00000002" });
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(2);
  });

  it("returns an existing Payment even when the repeated snapshot cannot be mapped", async () => {
    const first = await handleClaimPaymentRequested(handlerRequest());
    const repeated = await handleClaimPaymentRequested(
      handlerRequest({
        ...request,
        claim: { frn: "1101234567", totalAmountPence: 4200 },
      }),
    );

    expect(repeated.id).toBe(first.id);
    await assertOnePayment();
  });

  it("returns an existing Payment even when the repeated definition is unavailable", async () => {
    const first = await handleClaimPaymentRequested(handlerRequest());
    const repeated = await handleClaimPaymentRequested(
      handlerRequest({
        ...request,
        configVersion: "unavailable-version",
      }),
    );
    expect(repeated.id).toBe(first.id);
    await assertOnePayment();
  });

  it("returns the same Payment from concurrent handler calls", async () => {
    const [first, second] = await Promise.all([
      handleClaimPaymentRequested(handlerRequest()),
      handleClaimPaymentRequested(handlerRequest()),
    ]);
    expect(first).toBeInstanceOf(Payment);
    expect(second.id).toBe(first.id);
    await assertOnePayment();
  });

  it("retries a transient transaction failure without allocating another claim ID", async () => {
    const update = Collection.prototype.findOneAndUpdate;
    let attempts = 0;
    const retry = vi
      .spyOn(Collection.prototype, "findOneAndUpdate")
      .mockImplementation(function (filter, change, options) {
        if (this.collectionName === "payments__counters" && ++attempts === 1) {
          return Promise.reject(
            new MongoServerError({
              code: 112,
              errorLabels: ["TransientTransactionError"],
              errmsg: "transient write conflict",
            }),
          );
        }
        return update.call(this, filter, change, options);
      });
    try {
      const payment = await handleClaimPaymentRequested(handlerRequest());
      expect(payment).toBeInstanceOf(Payment);
    } finally {
      retry.mockRestore();
    }
    expect(attempts).toBe(2);
    await assertOnePayment();
  });

  it("recovers from a Claim source duplicate after an out-of-date lookup", async () => {
    const winner = await handleClaimPaymentRequested(handlerRequest());
    const findOne = Collection.prototype.findOne;
    let staleReads = 2; // Early identity check and in-transaction recheck.
    const lookup = vi
      .spyOn(Collection.prototype, "findOne")
      .mockImplementation(function (filter, options) {
        if (this.collectionName === "payments__payments" && staleReads > 0) {
          staleReads--;
          return Promise.resolve(null);
        }
        return findOne.call(this, filter, options);
      });
    const insertOne = Collection.prototype.insertOne;
    const duplicate = new MongoServerError({
      code: 11000,
      keyPattern: {
        "source.code": 1,
        "source.clientRef": 1,
        "source.clientClaimRef": 1,
      },
      errmsg: "duplicate Claim source",
    });
    const insert = vi
      .spyOn(Collection.prototype, "insertOne")
      .mockImplementation(function (document, options) {
        return this.collectionName === "payments__payments"
          ? Promise.reject(duplicate)
          : insertOne.call(this, document, options);
      });

    let recovered;
    try {
      recovered = await handleClaimPaymentRequested(handlerRequest());
    } finally {
      lookup.mockRestore();
      insert.mockRestore();
    }
    expect(recovered.id).toBe(winner.id);
    await assertOnePayment();
  });

  it("does not acknowledge a Claim source duplicate without a committed winner", async () => {
    const insertOne = Collection.prototype.insertOne;
    const duplicate = new MongoServerError({
      code: 11000,
      keyPattern: {
        "source.code": 1,
        "source.clientRef": 1,
        "source.clientClaimRef": 1,
      },
      errmsg: "duplicate Claim source",
    });
    const insert = vi
      .spyOn(Collection.prototype, "insertOne")
      .mockImplementation(function (document, options) {
        return this.collectionName === "payments__payments"
          ? Promise.reject(duplicate)
          : insertOne.call(this, document, options);
      });
    try {
      await expect(handleClaimPaymentRequested(handlerRequest())).rejects.toBe(
        duplicate,
      );
    } finally {
      insert.mockRestore();
    }
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(0);
  });

  it("does not acknowledge an unrelated duplicate-key error", async () => {
    const insertOne = Collection.prototype.insertOne;
    const duplicate = new MongoServerError({
      code: 11000,
      keyPattern: { paymentHubClaimId: 1 },
      errmsg: "duplicate Payment Hub claim ID",
    });
    const insert = vi
      .spyOn(Collection.prototype, "insertOne")
      .mockImplementation(function (document, options) {
        return this.collectionName === "payments__payments"
          ? Promise.reject(duplicate)
          : insertOne.call(this, document, options);
      });
    try {
      await expect(handleClaimPaymentRequested(handlerRequest())).rejects.toBe(
        duplicate,
      );
    } finally {
      insert.mockRestore();
    }
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(0);
  });

  it("leaves invalid snapshot mapping retryable without spoiling the next request", async () => {
    await expect(
      handleClaimPaymentRequested(
        handlerRequest({
          ...request,
          clientClaimRef: "bad-claim",
          claim: { frn: "1101234567", totalAmountPence: 4200 },
        }),
      ),
    ).rejects.not.toHaveProperty("retryable", false);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);

    const valid = await handleClaimPaymentRequested(
      handlerRequest({
        ...request,
        clientClaimRef: "good-claim",
      }),
    );
    expect(valid).toBeInstanceOf(Payment);
    await assertOnePayment();
  });
});
