import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { agreementsCollection } from "../repositories/agreement.repository.js";
import { checksum } from "./woodland-migration-checksum.js";
import {
  inspectWoodlandMigrationTargets,
  reconcileWoodlandMigration,
  writeWoodlandMigration,
} from "./woodland-migration.repository.js";

vi.mock("../../common/mongo-client.js");

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
    mappingVersion: 1,
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

beforeEach(() => vi.resetAllMocks());

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
          mappingVersion: 1,
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
