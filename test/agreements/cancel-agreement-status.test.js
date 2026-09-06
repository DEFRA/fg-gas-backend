import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const agreementNumber = "PMF823153890";
const commandId = "0f2c2d1e-5c47-4b1a-9d3f-1f1a0d0a5b21";
const createdAt = "2026-07-15T12:00:00.000Z";

const agreement = () => ({
  _id: agreementNumber,
  agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "pmf-cancellation-client",
  configVersion: "1.0.1",
  correlationId: "6ff2c3d1-a4a1-4a26-9d6e-5b0f3f5cbb17",
  identifiers: { sbi: "300000079", frn: "1101234567" },
  application: { whitePigsCount: 5 },
  actions: [],
  items: [],
  totalAmountPence: 5000,
  paymentSchedule: { instalments: [] },
  state: "offered",
  createdAt,
  updatedAt: createdAt,
});

const command = {
  id: commandId,
  type: "agreement.status.update",
  data: {
    agreementNumber,
    clientRef: "pmf-cancellation-client",
    code: "pigs-might-fly",
    status: "cancelled",
  },
};

describe("Agreement status cancellation", () => {
  let client;
  let agreements;
  let versions;
  let outbox;
  let payments;

  beforeAll(async () => {
    client = await MongoClient.connect(env.MONGO_URI);
    const database = client.db();
    agreements = database.collection("agreements__agreements");
    versions = database.collection("agreements__versions");
    outbox = database.collection("outbox");
    payments = database.collection("payments__payments");
  });

  beforeEach(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
      payments.deleteMany({ "source.agreementNumber": agreementNumber }),
    ]);
    const current = agreement();
    await agreements.insertOne(current);
    await versions.insertOne({
      agreementNumber,
      version: 1,
      snapshot: { ...current, _id: undefined },
      versionedAt: createdAt,
    });
  });

  afterAll(async () => {
    await Promise.all([
      agreements.deleteMany({ agreementNumber }),
      versions.deleteMany({ agreementNumber }),
      outbox.deleteMany({ "event.data.agreementNumber": agreementNumber }),
      payments.deleteMany({ "source.agreementNumber": agreementNumber }),
    ]);
    await client.close();
  });

  it("cancels once with lifecycle publications and no Payment", async () => {
    const enqueue = (_id) =>
      outbox.insertOne({
        _id,
        publicationDate: new Date(),
        target: "internal:message-bus",
        event: command,
        completionAttempts: 1,
        status: "PUBLISHED",
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        segregationRef: "pmf-cancellation-client-pigs-might-fly",
      });

    await enqueue("cancellation-command-1");
    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "cancelled",
    });
    await enqueue("cancellation-command-2");
    await expect(outbox).toHaveRecord({
      _id: "cancellation-command-2",
      status: "COMPLETED",
    });

    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "cancelled",
    });
    await expect(versions).toHaveRecord({
      agreementNumber,
      version: 2,
      actionExecution: { name: "cancel", idempotencyKey: commandId },
    });
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);
    expect(
      await payments.countDocuments({
        "source.agreementNumber": agreementNumber,
      }),
    ).toBe(0);

    const publications = await outbox
      .find({
        "event.data.agreementNumber": agreementNumber,
        "event.type": "io.onsite.agreement.status.updated",
      })
      .toArray();
    expect(publications).toHaveLength(2);
    expect(new Set(publications.map(({ event }) => event.id)).size).toBe(1);
    expect(publications.map(({ target }) => target).sort()).toEqual(
      [
        "internal:message-bus",
        env.GAS__SNS__AGREEMENT_STATUS_UPDATED_TOPIC_ARN,
      ].sort(),
    );
    expect(publications[0].event.data).toMatchObject({
      agreementNumber,
      code: "pigs-might-fly",
      status: "cancelled",
      version: 2,
    });
  });
});
