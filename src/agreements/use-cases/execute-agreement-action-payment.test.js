import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const agreementNumber = "PMF823153883";
const current = {
  agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "client-1",
  configVersion: "1.0.1",
  correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
  identifiers: { sbi: "106284736", frn: "1101234567" },
  actions: [],
  items: [],
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  totalAmountPence: 5000,
  paymentSchedule: {
    instalments: [{ dueDate: "2026-11-06", totalAmountPence: 5000 }],
  },
  state: "offered",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};
const accepted = {
  ...current,
  state: "accepted",
  version: 2,
  acceptedAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
};
const options = {
  actionName: "accept",
  idempotencyKey: "accept-1",
  current,
  next: {
    agreement: accepted,
    commitOperations: [{ type: "create-agreement-payment" }],
  },
};

let replSet;
let mongoClient;
let db;
let commitAgreementAction;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "agreement-payment-request-test");
  vi.resetModules();
  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  ({ commitAgreementAction } =
    await import("./execute-agreement-action.use-case.js"));
  await mongoClient.connect();
}, 120_000);

beforeEach(async () => {
  await Promise.all([
    db.collection("agreements__agreements").deleteMany({}),
    db.collection("agreements__versions").deleteMany({}),
    db.collection("outbox").deleteMany({}),
    db.collection("payments__payments").deleteMany({}),
  ]);
  await db.collection("agreements__agreements").insertOne({
    ...structuredClone(current),
    _id: agreementNumber,
  });
});

afterAll(async () => {
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
}, 120_000);

describe("Agreement acceptance Payment request", () => {
  it("commits an Agreement, Version, lifecycle and durable request without a Payment", async () => {
    await expect(commitAgreementAction(options)).resolves.toEqual({
      location: "/agreements/current",
    });

    await expect(
      db.collection("agreements__agreements").findOne({ _id: agreementNumber }),
    ).resolves.toMatchObject({ state: "accepted", version: 2 });
    await expect(
      db
        .collection("agreements__versions")
        .findOne({ agreementNumber, version: 2 }),
    ).resolves.toMatchObject({
      actionExecution: { name: "accept", idempotencyKey: "accept-1" },
    });
    await expect(
      db
        .collection("outbox")
        .findOne({ "event.data.source.agreementNumber": agreementNumber }),
    ).resolves.toMatchObject({
      target: "internal:message-bus",
      event: {
        data: {
          requestId: `agreement:${agreementNumber}:v2`,
          configVersion: "1.0.1",
          executedAt: accepted.updatedAt,
          snapshot: {
            agreementNumber,
            version: 2,
            paymentSchedule: accepted.paymentSchedule,
          },
        },
      },
    });
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);
  });

  it("does not commit a second request for a replayed action", async () => {
    await commitAgreementAction(options);
    await expect(commitAgreementAction(options)).resolves.toEqual({
      location: "/agreements/current",
    });

    await expect(
      db.collection("agreements__versions").countDocuments({ agreementNumber }),
    ).resolves.toBe(1);
    await expect(
      db.collection("outbox").countDocuments({
        "event.data.source.agreementNumber": agreementNumber,
      }),
    ).resolves.toBe(1);
  });

  it("accepts a Woodland Agreement without requesting an Agreement Payment", async () => {
    const woodlandCurrent = { ...current, code: "woodland" };
    const woodlandAccepted = { ...accepted, code: "woodland" };
    await db
      .collection("agreements__agreements")
      .updateOne({ _id: agreementNumber }, { $set: { code: "woodland" } });

    await expect(
      commitAgreementAction({
        ...options,
        current: woodlandCurrent,
        next: { agreement: woodlandAccepted, commitOperations: [] },
      }),
    ).resolves.toEqual({ location: "/agreements/current" });

    await expect(
      db.collection("agreements__agreements").findOne({ _id: agreementNumber }),
    ).resolves.toMatchObject({
      code: "woodland",
      state: "accepted",
      version: 2,
    });
    await expect(
      db
        .collection("outbox")
        .countDocuments({ target: "internal:message-bus" }),
    ).resolves.toBe(0);
    await expect(
      db.collection("payments__payments").countDocuments({}),
    ).resolves.toBe(0);
  });

  it("rejects unsupported operations without accepting the Agreement", async () => {
    await expect(
      commitAgreementAction({
        ...options,
        next: { ...options.next, commitOperations: [{ type: "unsupported" }] },
      }),
    ).rejects.toThrow(/Unsupported Agreement Action commit operation/);

    await expect(
      db.collection("agreements__agreements").findOne({ _id: agreementNumber }),
    ).resolves.toMatchObject({ state: "offered", version: 1 });
    await expect(db.collection("outbox").countDocuments({})).resolves.toBe(0);
  });
});
