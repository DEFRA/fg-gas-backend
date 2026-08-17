import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const agreementNumber = "PMF823153889";
const commandId = "6cc6b692-cc2a-441f-b95f-cf436e7cb670";
const createdAt = "2026-07-15T12:00:00.000Z";

const agreement = () => ({
  _id: agreementNumber,
  agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "pmf-withdrawal-client",
  configVersion: "1.0.1",
  correlationId: "b5e8b244-6d60-42cd-8da6-3294c7439239",
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
    clientRef: "pmf-withdrawal-client",
    code: "pigs-might-fly",
    status: "withdrawn",
  },
};

describe("Agreement status withdrawal", () => {
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

  it("withdraws once with lifecycle publications and no Payment", async () => {
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
        segregationRef: "pmf-withdrawal-client-pigs-might-fly",
      });

    await enqueue("withdrawal-command-1");
    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "withdrawn",
    });
    await enqueue("withdrawal-command-2");
    await expect(outbox).toHaveRecord({
      _id: "withdrawal-command-2",
      status: "COMPLETED",
    });

    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "withdrawn",
    });
    await expect(versions).toHaveRecord({
      agreementNumber,
      version: 2,
      actionExecution: { name: "withdraw", idempotencyKey: commandId },
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
      status: "withdrawn",
      version: 2,
    });
  });
});
