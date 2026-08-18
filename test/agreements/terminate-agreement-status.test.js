import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const agreementNumber = "PMF823153891";
const commandId = "2b7a6e90-3f18-4a55-8c21-9f0d4c7e1a63";
const createdAt = "2026-07-15T12:00:00.000Z";
const acceptedAt = "2026-07-16T09:30:00.000Z";

const paymentSchedule = {
  instalments: [
    {
      id: "instalment:1",
      dueDate: "2026-11-06",
      totalAmountPence: 5000,
      lineItems: [{ actionId: "action:1", amountPence: 5000 }],
    },
  ],
};

const agreement = () => ({
  _id: agreementNumber,
  agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "pmf-termination-client",
  configVersion: "1.0.1",
  correlationId: "8c1d0f4a-2b93-4d17-a5e2-0c6b9f3d8a41",
  identifiers: { sbi: "300000079", frn: "1101234567" },
  application: { whitePigsCount: 5 },
  actions: [],
  items: [],
  totalAmountPence: 5000,
  paymentSchedule,
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  acceptedAt,
  state: "accepted",
  createdAt,
  updatedAt: acceptedAt,
});

const command = {
  id: commandId,
  type: "agreement.status.update",
  data: {
    agreementNumber,
    clientRef: "pmf-termination-client",
    code: "pigs-might-fly",
    status: "terminated",
  },
};

describe("Agreement status termination", () => {
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
      versionedAt: acceptedAt,
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

  it("terminates once and leaves the accepted Payment untouched", async () => {
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
        segregationRef: "pmf-termination-client-pigs-might-fly",
      });

    await enqueue("termination-command-1");
    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "terminated",
    });
    await enqueue("termination-command-2");
    await expect(outbox).toHaveRecord({
      _id: "termination-command-2",
      status: "COMPLETED",
    });

    await expect(agreements).toHaveRecord({
      agreementNumber,
      version: 2,
      state: "terminated",
    });
    await expect(versions).toHaveRecord({
      agreementNumber,
      version: 2,
      actionExecution: { name: "terminate", idempotencyKey: commandId },
    });
    expect(await versions.countDocuments({ agreementNumber })).toBe(2);

    // FGP-1374 preserves the accepted Agreement's payment data; FGP-1313 owns
    // any later decision to cancel remaining payments.
    const terminated = await agreements.findOne({ agreementNumber });
    expect(terminated.paymentSchedule).toEqual(paymentSchedule);
    expect(terminated.totalAmountPence).toBe(5000);
    expect(terminated.acceptedAt).toBe(acceptedAt);
    expect(terminated.startDate).toBe("2026-08-01");
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
      status: "terminated",
      version: 2,
    });
  });
});
