import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, mongoClient } from "../../src/common/mongo-client.js";
import { withTransaction } from "../../src/common/with-transaction.js";
import {
  allocateNextSequence,
  CLAIM_ID_SEED,
  ClaimIdCounter,
  countersCollection,
} from "../../src/payments/repositories/counter.repository.js";
import { paymentsCollection } from "../../src/payments/repositories/payment.repository.js";
import { formatClaimId } from "../../src/payments/services/claim-id.js";
import {
  applyClaimIdCounterInitialisation,
  reconcileClaimIdCounterInitialisation,
} from "../../src/payments/use-cases/initialise-claim-id-counter.use-case.js";

const target = { persistedSeq: 4999 };

const clearData = () =>
  Promise.all([
    db.collection(countersCollection).deleteMany({ _id: ClaimIdCounter }),
    db.collection(paymentsCollection).deleteMany({}),
  ]);

const resetSeed = async () => {
  await clearData();
  await db
    .collection(countersCollection)
    .insertOne({ _id: ClaimIdCounter, seq: CLAIM_ID_SEED });
};

const readSequence = async () =>
  (await db.collection(countersCollection).findOne({ _id: ClaimIdCounter }))
    .seq;

describe("claim ID counter initialisation integration", () => {
  beforeAll(() => mongoClient.connect());
  beforeEach(resetSeed);
  afterAll(async () => {
    await clearData();
    await mongoClient.close();
  });

  it("lowers the seed and allocates R00005000 next", async () => {
    const decision = await withTransaction((session) =>
      applyClaimIdCounterInitialisation(target, session),
    );

    expect(decision).toMatchObject({
      action: "lower",
      currentSeq: CLAIM_ID_SEED,
      persistedSeq: 4999,
    });
    expect(await readSequence()).toBe(4999);
    await expect(
      reconcileClaimIdCounterInitialisation(target),
    ).resolves.toBeUndefined();

    const nextSequence = await withTransaction((session) =>
      allocateNextSequence(ClaimIdCounter, session),
    );
    expect(nextSequence).toBe(5000);
    expect(formatClaimId(nextSequence)).toBe("R00005000");
  });

  it("treats a rerun at the target as a no-op", async () => {
    await db
      .collection(countersCollection)
      .updateOne({ _id: ClaimIdCounter }, { $set: { seq: 4999 } });

    const decision = await withTransaction((session) =>
      applyClaimIdCounterInitialisation(target, session),
    );

    expect(decision).toMatchObject({
      action: "noop",
      currentSeq: 4999,
      persistedSeq: 4999,
    });
    expect(await readSequence()).toBe(4999);
  });

  it("rejects initialisation when a payment exists", async () => {
    await db.collection(paymentsCollection).insertOne({ _id: "payment-1" });

    await expect(
      withTransaction((session) =>
        applyClaimIdCounterInitialisation(target, session),
      ),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(await readSequence()).toBe(CLAIM_ID_SEED);
  });

  it("rejects initialisation from an unexpected counter state", async () => {
    await db
      .collection(countersCollection)
      .updateOne({ _id: ClaimIdCounter }, { $set: { seq: 5_000_000 } });

    await expect(
      withTransaction((session) =>
        applyClaimIdCounterInitialisation(target, session),
      ),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(await readSequence()).toBe(5_000_000);
  });

  it("rolls the counter update back when the transaction fails", async () => {
    await expect(
      withTransaction(async (session) => {
        await applyClaimIdCounterInitialisation(target, session);
        throw new Error("fail after counter write");
      }),
    ).rejects.toThrow("fail after counter write");

    expect(await readSequence()).toBe(CLAIM_ID_SEED);
  });
});
