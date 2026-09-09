import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { withTransaction } from "../../common/with-transaction.js";
import { agreementsCollection } from "../repositories/agreement.repository.js";
import { checksum } from "./woodland-migration-checksum.js";
import {
  catchUpWoodlandAgreement,
  inspectWoodlandMigrationTargets,
  reconcileWoodlandMigration,
  writeWoodlandMigration,
} from "./woodland-migration.repository.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");

const envelope = { version: { source: true } };
const evidenceChecksum = checksum(envelope);
const sourceChecksum = `sha256:${"2".repeat(64)}`;
const agreement = {
  agreementNumber: "WMP0001",
  version: 1,
  code: "woodland",
  clientRef: "client-1",
  configVersion: "1.0.0",
  identifiers: { sbi: "123" },
  actions: [],
  items: [],
};
const preparedAgreement = {
  agreementNumber: agreement.agreementNumber,
  sourceChecksum,
  versions: [
    {
      agreementVersion: {
        agreementNumber: agreement.agreementNumber,
        version: 1,
        snapshot: agreement,
        versionedAt: "2026-01-01T00:00:00.000Z",
      },
      evidence: {
        source: "legacy-agreements",
        checksum: evidenceChecksum,
        envelope,
      },
    },
  ],
};

const ownedCurrent = (overrides = {}) => ({
  _id: agreement.agreementNumber,
  ...agreement,
  migration: {
    name: "woodland",
    source: "legacy-agreements",
    sourceChecksum,
  },
  ...overrides,
});

const storedVersion = (overrides = {}) => ({
  agreementNumber: agreement.agreementNumber,
  version: 1,
  versionedAt: "2026-01-01T00:00:00.000Z",
  snapshot: {
    ...agreement,
    legacy: {
      source: "legacy-agreements",
      checksum: evidenceChecksum,
      envelope: { version: { source: true } },
    },
  },
  ...overrides,
});

// eslint-disable-next-line complexity
const setupCollections = ({ current = [], versions = [] } = {}) => {
  const currentFind = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue(current),
  });
  const versionToArray = vi.fn().mockResolvedValue(versions);
  const versionFind = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ toArray: versionToArray }),
  });
  const agreements = {
    find: currentFind,
    findOne: vi
      .fn()
      .mockResolvedValueOnce(current[0] ?? null)
      .mockResolvedValueOnce(current[1] ?? null),
    insertOne: vi.fn(),
    replaceOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const agreementVersions = {
    find: versionFind,
    insertMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  db.collection.mockImplementation((name) =>
    name === agreementsCollection ? agreements : agreementVersions,
  );
  return { agreements, agreementVersions };
};

beforeEach(() => {
  vi.resetAllMocks();
  withTransaction.mockImplementation((callback) =>
    callback({ id: "catch-up-session" }),
  );
});

describe("catchUpWoodlandAgreement", () => {
  it("inserts a missing agreement and its legacy evidence", async () => {
    const { agreements, agreementVersions } = setupCollections();
    const session = { id: "catch-up-session" };

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "inserted",
    });

    expect(agreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "WMP0001",
        migration: {
          name: "woodland",
          source: "legacy-agreements",
          sourceChecksum,
        },
      }),
      { session },
    );
    expect(agreementVersions.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          snapshot: expect.objectContaining({
            legacy: preparedAgreement.versions[0].evidence,
          }),
        }),
      ],
      { session },
    );
  });

  it("replaces changed migration-owned data and its history", async () => {
    const { agreements, agreementVersions } = setupCollections({
      current: [
        ownedCurrent({
          migration: { ...ownedCurrent().migration, sourceChecksum: "changed" },
        }),
      ],
      versions: [storedVersion()],
    });

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "updated",
    });
    expect(agreements.replaceOne).toHaveBeenCalledWith(
      {
        _id: "WMP0001",
        "migration.name": "woodland",
        "migration.source": "legacy-agreements",
      },
      expect.any(Object),
      { session: { id: "catch-up-session" } },
    );
    expect(agreementVersions.deleteMany).toHaveBeenCalledWith(
      { agreementNumber: "WMP0001" },
      { session: { id: "catch-up-session" } },
    );
    expect(agreementVersions.insertMany).toHaveBeenCalledOnce();
  });

  it.each([
    ["an unchanged checksum", ownedCurrent()],
    [
      "a current agreement without a migration marker",
      ownedCurrent({ migration: undefined }),
    ],
  ])("preserves %s without writes", async (_scenario, current) => {
    const { agreements, agreementVersions } = setupCollections({
      current: [current],
      versions: [storedVersion()],
    });

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "preserved",
    });
    expect(agreements.insertOne).not.toHaveBeenCalled();
    expect(agreements.replaceOne).not.toHaveBeenCalled();
    expect(agreementVersions.deleteMany).not.toHaveBeenCalled();
    expect(agreementVersions.insertMany).not.toHaveBeenCalled();
  });

  it("reports a marker conflict before rewriting history", async () => {
    const { agreements, agreementVersions } = setupCollections({
      current: [
        ownedCurrent({
          migration: { ...ownedCurrent().migration, sourceChecksum: "changed" },
        }),
      ],
      versions: [storedVersion()],
    });
    agreements.replaceOne.mockResolvedValue({ matchedCount: 0 });

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "failed",
      reason: "marker.conflict",
    });
    expect(agreementVersions.deleteMany).not.toHaveBeenCalled();
    expect(agreementVersions.insertMany).not.toHaveBeenCalled();
  });

  it("reports when another agreement owns the prepared identity", async () => {
    setupCollections({
      current: [undefined, ownedCurrent({ _id: "WMP9999" })],
    });

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "failed",
      reason: "identity.mismatch",
    });
  });

  it("reports identity drift on a migration-owned current agreement", async () => {
    setupCollections({ current: [ownedCurrent({ clientRef: "different" })] });

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "failed",
      reason: "identity.mismatch",
    });
  });

  it("reports orphaned history for an agreement without a current document", async () => {
    setupCollections({ versions: [storedVersion()] });

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "failed",
      reason: "history.orphaned",
    });
  });

  it("resolves write failures to a safe reason", async () => {
    const { agreementVersions } = setupCollections();
    agreementVersions.insertMany.mockRejectedValue(new Error("private data"));

    await expect(catchUpWoodlandAgreement(preparedAgreement)).resolves.toEqual({
      outcome: "failed",
      reason: "write.error",
    });
  });
});

describe("Woodland migration repository", () => {
  it("inserts a source agreement when no target data exists", async () => {
    setupCollections();

    await expect(
      inspectWoodlandMigrationTargets([preparedAgreement]),
    ).resolves.toEqual({
      insert: [preparedAgreement],
      replace: [],
      skip: [],
    });
  });

  it("skips a complete migration-owned agreement with the same checksum", async () => {
    setupCollections({
      current: [ownedCurrent()],
      versions: [storedVersion()],
    });

    await expect(
      inspectWoodlandMigrationTargets([preparedAgreement]),
    ).resolves.toEqual({
      insert: [],
      replace: [],
      skip: [preparedAgreement],
    });
  });

  it.each([
    [
      "changed source",
      ownedCurrent({
        migration: { ...ownedCurrent().migration, sourceChecksum: "changed" },
      }),
      storedVersion(),
    ],
    ["incomplete history", ownedCurrent(), null],
    [
      "changed evidence",
      ownedCurrent(),
      storedVersion({ snapshot: { legacy: { checksum: "changed" } } }),
    ],
    [
      "changed mapped snapshot",
      ownedCurrent(),
      storedVersion({
        snapshot: {
          ...agreement,
          clientRef: "corrupt",
          legacy: preparedAgreement.versions[0].evidence,
        },
      }),
    ],
    [
      "changed current Agreement",
      ownedCurrent({ items: [{ code: "corrupt" }] }),
      storedVersion(),
    ],
  ])(
    "rebuilds migration-owned data with %s",
    async (_scenario, current, version) => {
      setupCollections({
        current: [current],
        versions: version ? [version] : [],
      });

      await expect(
        inspectWoodlandMigrationTargets([preparedAgreement]),
      ).resolves.toEqual({
        insert: [],
        replace: [preparedAgreement],
        skip: [],
      });
    },
  );

  it("rejects an unrelated current Agreement before writing", async () => {
    setupCollections({
      current: [{ _id: agreement.agreementNumber, ...agreement }],
    });

    await expect(
      inspectWoodlandMigrationTargets([preparedAgreement]),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("rejects orphan target versions before writing", async () => {
    setupCollections({ versions: [storedVersion()] });

    await expect(
      inspectWoodlandMigrationTargets([preparedAgreement]),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("rejects a source identity owned by another Agreement number", async () => {
    setupCollections({
      current: [ownedCurrent({ _id: "WMP9999" })],
    });

    await expect(
      inspectWoodlandMigrationTargets([preparedAgreement]),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("rejects migration-owned evidence that is no longer present in the source", async () => {
    setupCollections({
      versions: [storedVersion({ agreementNumber: "WMP9999" })],
    });

    await expect(
      inspectWoodlandMigrationTargets([preparedAgreement]),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("stores migration ownership and legacy evidence without outbox writes", async () => {
    const { agreements, agreementVersions } = setupCollections();
    const session = { id: "session" };

    await writeWoodlandMigration(
      { insert: [preparedAgreement], replace: [], skip: [] },
      session,
    );

    expect(agreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "WMP0001",
        migration: {
          name: "woodland",
          source: "legacy-agreements",
          sourceChecksum,
        },
      }),
      { session },
    );
    expect(agreementVersions.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          agreementNumber: "WMP0001",
          version: 1,
          snapshot: expect.objectContaining({
            legacy: preparedAgreement.versions[0].evidence,
          }),
        }),
      ],
      { session },
    );
  });

  it("atomically replaces the complete history of changed owned data", async () => {
    const { agreements, agreementVersions } = setupCollections();
    const session = { id: "session" };

    await writeWoodlandMigration(
      { insert: [], replace: [preparedAgreement], skip: [] },
      session,
    );

    expect(agreements.replaceOne).toHaveBeenCalledWith(
      {
        _id: "WMP0001",
        "migration.name": "woodland",
        "migration.source": "legacy-agreements",
      },
      expect.any(Object),
      { session },
    );
    expect(agreementVersions.deleteMany).toHaveBeenCalledWith(
      { agreementNumber: "WMP0001" },
      { session },
    );
    expect(agreementVersions.insertMany).toHaveBeenCalledOnce();
  });

  it("reconciles only when every prepared Agreement is a complete no-op", async () => {
    setupCollections({
      current: [ownedCurrent()],
      versions: [storedVersion()],
    });

    await expect(
      reconcileWoodlandMigration([preparedAgreement]),
    ).resolves.toBeUndefined();
  });
});
