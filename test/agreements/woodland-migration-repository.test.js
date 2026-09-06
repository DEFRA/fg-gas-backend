import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgreementVersion } from "../../src/agreements/models/agreement-version.js";
import { Agreement } from "../../src/agreements/models/agreement.js";
import {
  agreementsCollection,
  versionsCollection,
} from "../../src/agreements/repositories/agreement.repository.js";
import {
  createAgreementSourceChecksum,
  createLegacyEvidence,
} from "../../src/agreements/woodland-migration/woodland-migration-checksum.js";
import {
  inspectWoodlandMigrationTargets,
  reconcileWoodlandMigration,
  writeWoodlandMigration,
} from "../../src/agreements/woodland-migration/woodland-migration.repository.js";
import { db, mongoClient } from "../../src/common/mongo-client.js";
import { withTransaction } from "../../src/common/with-transaction.js";

const agreementNumber = "WMP-MIGRATION-INTEGRATION";
const clientRef = "woodland-migration-integration";

const prepareAgreement = ({ amount = 100, sourceRevision = 1 } = {}) => {
  const agreement = new Agreement({
    agreementNumber,
    version: 1,
    code: "woodland",
    clientRef,
    configVersion: "1.0.0",
    correlationId: "migration-correlation",
    identifiers: { sbi: "300000001", frn: "1000000001", crn: "1000000001" },
    schemeCode: "WMP",
    name: "Integration woodland WMP",
    applicant: {
      business: { name: "Woodland", address: {} },
      customer: { name: { first: "Test", last: "User" } },
    },
    application: { woodlandName: "Integration woodland" },
    parcels: [],
    actions: [],
    items: [],
    totalAmountPence: amount,
    state: "offered",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const agreementVersion = new AgreementVersion({
    agreementNumber,
    version: 1,
    snapshot: agreement,
    versionedAt: "2026-01-01T00:00:00.000Z",
  });
  const evidence = createLegacyEvidence({
    agreement: { agreementNumber },
    grant: { code: "woodland" },
    version: {
      sourceRevision,
      amount: { $numberLong: String(amount) },
      quantity: { $numberDecimal: "4.7500" },
      createdAt: { $date: { $numberLong: "1767225600000" } },
    },
  });
  const sourceChecksum = createAgreementSourceChecksum({
    agreementNumber,
    configVersion: "1.0.0",
    versionChecksums: [evidence.checksum],
  });
  return {
    agreementNumber,
    sourceChecksum,
    versions: [{ agreementVersion, evidence }],
  };
};

const clearData = () =>
  Promise.all([
    db.collection(agreementsCollection).deleteMany({
      $or: [{ _id: agreementNumber }, { code: "woodland", clientRef }],
    }),
    db.collection(versionsCollection).deleteMany({ agreementNumber }),
  ]);

describe("Woodland migration repository integration", () => {
  beforeAll(() => mongoClient.connect());
  beforeEach(clearData);
  afterAll(async () => {
    await clearData();
    await mongoClient.close();
  });

  it("atomically imports, skips an unchanged rerun, and rebuilds changed owned data", async () => {
    const initial = prepareAgreement();

    const first = await withTransaction(async (session) => {
      const decisions = await inspectWoodlandMigrationTargets(
        [initial],
        session,
      );
      await writeWoodlandMigration(decisions, session);
      await reconcileWoodlandMigration([initial], session);
      return decisions;
    });

    expect(first).toMatchObject({ insert: [initial], replace: [], skip: [] });
    await expect(
      reconcileWoodlandMigration([initial]),
    ).resolves.toBeUndefined();

    const unchanged = await inspectWoodlandMigrationTargets([initial]);
    expect(unchanged).toMatchObject({
      insert: [],
      replace: [],
      skip: [initial],
    });

    const changed = prepareAgreement({ amount: 200, sourceRevision: 2 });
    await withTransaction(async (session) => {
      const decisions = await inspectWoodlandMigrationTargets(
        [changed],
        session,
      );
      expect(decisions).toMatchObject({
        insert: [],
        replace: [changed],
        skip: [],
      });
      await writeWoodlandMigration(decisions, session);
      await reconcileWoodlandMigration([changed], session);
    });

    const current = await db
      .collection(agreementsCollection)
      .findOne({ _id: agreementNumber });
    const versions = await db
      .collection(versionsCollection)
      .find({ agreementNumber })
      .toArray();
    expect(current).toMatchObject({
      totalAmountPence: 200,
      migration: { sourceChecksum: changed.sourceChecksum },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      snapshot: {
        totalAmountPence: 200,
        legacy: changed.versions[0].evidence,
      },
    });
  });

  it("rolls back every migration write when the transaction fails", async () => {
    const prepared = prepareAgreement();

    await expect(
      withTransaction(async (session) => {
        const decisions = await inspectWoodlandMigrationTargets(
          [prepared],
          session,
        );
        await writeWoodlandMigration(decisions, session);
        throw new Error("fail after writes");
      }),
    ).rejects.toThrow("fail after writes");

    expect(
      await db
        .collection(agreementsCollection)
        .countDocuments({ _id: agreementNumber }),
    ).toBe(0);
    expect(
      await db
        .collection(versionsCollection)
        .countDocuments({ agreementNumber }),
    ).toBe(0);
  });

  it("rejects unrelated GAS data without changing it", async () => {
    await db.collection(agreementsCollection).insertOne({
      _id: agreementNumber,
      agreementNumber,
      version: 1,
      code: "woodland",
      clientRef,
    });

    await expect(
      inspectWoodlandMigrationTargets([prepareAgreement()]),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });

    expect(
      await db.collection(agreementsCollection).countDocuments({
        _id: agreementNumber,
        migration: { $exists: true },
      }),
    ).toBe(0);
    expect(
      await db
        .collection(versionsCollection)
        .countDocuments({ agreementNumber }),
    ).toBe(0);
  });
});
